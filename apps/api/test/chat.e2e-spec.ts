import { randomUUID } from 'node:crypto';
import { MESSAGES_PAGE_SIZE, socketEvents } from '@despacho/shared';
import { sql } from 'drizzle-orm';
import type { Socket } from 'socket.io-client';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { ownerPool, resetState } from './support/db.js';
import {
  asUser,
  categoryOf,
  clientOf,
  companyWithAdmin,
  createScenario,
  http,
  readyProvider,
  type Scenario,
} from './support/scenarios.js';
import { connect, listen, nextEvent } from './support/socket.js';

const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 };

describe('chat de texto', () => {
  let s: Scenario;
  let url: string;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  let joao: { token: string; membershipId: string };
  let requestId: string;
  const sockets: Socket[] = [];
  const at = (token: string, companyId = admin.companyId) => asUser(token, companyId);
  const send = (token: string, body: object, id = requestId, companyId = admin.companyId) =>
    http(s).post(`/company/service-requests/${id}/messages`).set(at(token, companyId)).send(body);
  const say = (token: string, text: string) => send(token, { clientMessageId: randomUUID(), body: text });
  const list = (token: string, cursor?: string, id = requestId, companyId = admin.companyId) =>
    http(s).get(`/company/service-requests/${id}/messages`).query(cursor ? { cursor } : {}).set(at(token, companyId));
  const status = (to: string) =>
    http(s).post(`/company/service-requests/${requestId}/status`).set(at(joao.token)).send({ status: to }).expect(200);
  const newRequest = async () =>
    (
      await http(s)
        .post('/company/service-requests')
        .set(at(client))
        .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    s = await createScenario();
    url = await listen(s.app);
  });

  beforeEach(async () => {
    await resetState();
    s.mailer.sent.length = 0;
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    eletrica = await categoryOf(s, admin, 'Elétrica');
    client = await clientOf(s, admin, 'Rita Souza', 'rita@email.com');
    joao = await readyProvider(s, admin, 'João Lima', 'joao@email.com', { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
    requestId = await newRequest();
  });

  const confirm = async () => {
    await http(s).post(`/company/service-requests/${requestId}/accept`).set(at(joao.token)).expect(200);
    await http(s).post(`/company/service-requests/${requestId}/confirm`).set(at(client)).expect(200);
  };

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  describe('quem escreve e quando', () => {
    it('só depois da confirmação; cliente e prestador conversam e veem tudo em ordem', async () => {
      // Ainda aberto: o cliente não pode escrever e o prestador nem é do pedido.
      await say(client, 'Oi, tem previsão?').expect(409);
      await say(joao.token, 'Posso ir agora?').expect(404);
      await http(s).post(`/company/service-requests/${requestId}/accept`).set(at(joao.token)).expect(200);
      const early = await say(client, 'Oi!').expect(409);
      expect(early.body.message).toBe('A conversa está encerrada');
      await say(joao.token, 'Posso ir agora?').expect(409);
      await http(s).post(`/company/service-requests/${requestId}/confirm`).set(at(client)).expect(200);

      const first = await say(client, 'Oi, tem previsão?').expect(200);
      expect(first.body).toEqual({
        id: expect.any(String),
        serviceRequestId: requestId,
        clientMessageId: expect.any(String),
        senderRole: 'client',
        senderName: 'Rita Souza',
        body: 'Oi, tem previsão?',
        createdAt: expect.any(String),
      });
      await say(joao.token, 'Chego em 20 minutos').expect(200);
      await say(client, 'Combinado').expect(200);

      for (const token of [client, joao.token, admin.token]) {
        const page = (await list(token).expect(200)).body;
        expect(page.nextCursor).toBeNull();
        expect(page.messages.map((m: { body: string; senderRole: string }) => [m.senderRole, m.body])).toEqual([
          ['client', 'Oi, tem previsão?'],
          ['provider', 'Chego em 20 minutos'],
          ['client', 'Combinado'],
        ]);
      }
    });

    it('escreve em confirmado, a caminho, chegou e em execução; fica só leitura em concluído e cancelado', async () => {
      await confirm();
      await say(client, 'confirmado').expect(200);
      await status('en_route');
      await say(joao.token, 'a caminho').expect(200);
      await status('arrived');
      await say(client, 'pode subir').expect(200);
      await status('in_progress');
      await say(joao.token, 'em execução').expect(200);
      await status('completed');

      const closed = await say(client, 'obrigado').expect(409);
      expect(closed.body.message).toBe('A conversa está encerrada');
      await say(joao.token, 'de nada').expect(409);
      expect((await list(client).expect(200)).body.messages).toHaveLength(4);
      expect((await list(joao.token).expect(200)).body.messages).toHaveLength(4);

      // Cancelado: também só leitura, com o histórico preservado.
      const other = await newRequest();
      await http(s).post(`/company/service-requests/${other}/accept`).set(at(joao.token)).expect(200);
      await http(s).post(`/company/service-requests/${other}/confirm`).set(at(client)).expect(200);
      await send(client, { clientMessageId: randomUUID(), body: 'antes de cancelar' }, other).expect(200);
      await http(s).post(`/company/service-requests/${other}/cancel`).set(at(client)).send({ reason: 'Desisti do serviço' }).expect(204);
      await send(client, { clientMessageId: randomUUID(), body: 'depois' }, other).expect(409);
      expect((await list(client, undefined, other).expect(200)).body.messages.map((m: { body: string }) => m.body)).toEqual(['antes de cancelar']);
    });

    it('o admin lê mas não escreve; outras pessoas nem leem', async () => {
      await confirm();
      await say(client, 'oi').expect(200);
      await say(admin.token, 'oi do admin').expect(404);

      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      const maria = await readyProvider(s, admin, 'Maria', 'maria@email.com', { categoryIds: [eletrica], base: paulista });
      for (const token of [bruno, maria.token]) {
        await list(token).expect(404);
        await say(token, 'intruso').expect(404);
      }
      await list(client, undefined, randomUUID()).expect(404);
    });
  });

  describe('reenvio e validação', () => {
    it('reenviar a mesma mensagem não a duplica e devolve a original', async () => {
      await confirm();
      const clientMessageId = randomUUID();
      const first = await send(client, { clientMessageId, body: 'Chegou?' }).expect(200);
      const again = await send(client, { clientMessageId, body: 'Chegou?' }).expect(200);
      expect(again.body).toEqual(first.body);
      expect((await ownerPool.query(`select count(*)::int as n from messages`)).rows[0].n).toBe(1);
      expect((await list(joao.token).expect(200)).body.messages).toHaveLength(1);
    });

    it('o mesmo clientMessageId em outra conversa ou de outra pessoa é outra mensagem', async () => {
      await confirm();
      const clientMessageId = randomUUID();
      await send(client, { clientMessageId, body: 'a' }).expect(200);
      await send(joao.token, { clientMessageId, body: 'b' }).expect(200);
      expect((await list(client).expect(200)).body.messages).toHaveLength(2);
    });

    it('rejeita mensagem vazia, longa demais e id inválido', async () => {
      await confirm();
      await send(client, { clientMessageId: randomUUID(), body: '   ' }).expect(400);
      await send(client, { clientMessageId: randomUUID(), body: 'x'.repeat(2001) }).expect(400);
      await send(client, { clientMessageId: 'não-é-uuid', body: 'oi' }).expect(400);
      await send(client, { body: 'oi' }).expect(400);
      await send(client, { clientMessageId: randomUUID(), body: 'x'.repeat(2000) }).expect(200);
    });

    it('mantém a ordem mesmo com mensagens no mesmo instante', async () => {
      await confirm();
      for (const n of [1, 2, 3, 4, 5]) await say(n % 2 ? client : joao.token, String(n)).expect(200);
      expect((await list(client).expect(200)).body.messages.map((m: { body: string }) => m.body)).toEqual(['1', '2', '3', '4', '5']);
    });
  });

  describe('paginação por cursor', () => {
    it('devolve as mais recentes primeiro e segue para as mais antigas até acabar', async () => {
      await confirm();
      const total = MESSAGES_PAGE_SIZE * 2 + 5;
      for (let i = 1; i <= total; i++) await say(i % 2 ? client : joao.token, `mensagem ${i}`).expect(200);

      const pages: string[][] = [];
      let cursor: string | undefined;
      do {
        const page = (await list(client, cursor).expect(200)).body as { messages: { body: string }[]; nextCursor: string | null };
        pages.push(page.messages.map((m) => m.body));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(pages.map((p) => p.length)).toEqual([MESSAGES_PAGE_SIZE, MESSAGES_PAGE_SIZE, 5]);
      expect(pages[0][MESSAGES_PAGE_SIZE - 1]).toBe(`mensagem ${total}`); // cronológico dentro da página
      expect(pages[2][0]).toBe('mensagem 1');
      expect(pages.flat().reverse().length).toBe(total);
      expect(new Set(pages.flat()).size).toBe(total);
      await list(client, 'abc').expect(400);
      await list(client, '-3').expect(400);
    });
  });

  describe('tempo real', () => {
    it('o outro lado e quem acompanha o pedido recebem a mensagem; quem não é do pedido, não', async () => {
      await confirm();
      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      const providerSocket = await connect(url, joao.token);
      const clientSocket = await connect(url, client);
      const adminSocket = await connect(url, admin.token);
      const strangerSocket = await connect(url, bruno);
      sockets.push(providerSocket, clientSocket, adminSocket, strangerSocket);
      expect(await adminSocket.emitWithAck(socketEvents.subscribeServiceRequest, { serviceRequestId: requestId })).toEqual({ ok: true });
      let leaked = 0;
      strangerSocket.on(socketEvents.messageNew, () => leaked++);

      const received = [providerSocket, clientSocket, adminSocket].map((socket) => nextEvent<{ body: string; senderName: string }>(socket, socketEvents.messageNew));
      await say(client, 'Oi, João').expect(200);
      for (const event of await Promise.all(received)) expect(event).toMatchObject({ body: 'Oi, João', senderName: 'Rita Souza' });
      expect(leaked).toBe(0);
    });

    it('reenvio não emite de novo', async () => {
      await confirm();
      const providerSocket = await connect(url, joao.token);
      sockets.push(providerSocket);
      let count = 0;
      providerSocket.on(socketEvents.messageNew, () => count++);
      const clientMessageId = randomUUID();
      await send(client, { clientMessageId, body: 'oi' }).expect(200);
      await send(client, { clientMessageId, body: 'oi' }).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(count).toBe(1);
    });
  });

  describe('isolamento entre empresas', () => {
    it('outra empresa não lê nem escreve, e o RLS esconde as mensagens', async () => {
      await confirm();
      await say(client, 'conversa privada').expect(200);
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const eletricaB = await categoryOf(s, b, 'Elétrica');
      const carlos = await readyProvider(s, b, 'Carlos', 'carlos@email.com', { categoryIds: [eletricaB], base: paulista });
      const deB = await clientOf(s, b, 'Bruno B', 'brunob@email.com');

      for (const token of [b.token, carlos.token, deB]) {
        await list(token, undefined, requestId, b.companyId).expect(404);
        await send(token, { clientMessageId: randomUUID(), body: 'x' }, requestId, b.companyId).expect(token === b.token ? 404 : 404);
      }
      // O cliente da empresa A, agindo no contexto da empresa B, também não alcança.
      await list(client, undefined, requestId, b.companyId).expect(404);

      const me = (await http(s).get('/me').set(asUser(b.token)).expect(200)).body;
      const rows = await s.app
        .get(TenantTransactions)
        .run({ userId: me.user.id, companyId: b.companyId }, async (tx) => (await tx.execute(sql`select * from messages`)).rows);
      expect(rows).toEqual([]);
    });
  });
});
