import { socketEvents } from '@despacho/shared';
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

describe('o cliente confirma ou recusa o prestador', () => {
  let s: Scenario;
  let url: string;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  const sockets: Socket[] = [];
  const at = (token: string) => asUser(token, admin.companyId);
  const createRequest = async (token = client) =>
    (
      await http(s)
        .post('/company/service-requests')
        .set(at(token))
        .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body;
  const ready = (name: string, email: string) =>
    readyProvider(s, admin, name, email, { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
  const accept = (token: string, id: string) => http(s).post(`/company/service-requests/${id}/accept`).set(at(token));
  const confirm = (token: string, id: string) => http(s).post(`/company/service-requests/${id}/confirm`).set(at(token));
  const refuse = (token: string, id: string) => http(s).post(`/company/service-requests/${id}/decline-provider`).set(at(token));
  const mine = async (token = client) => (await http(s).get('/my/service-requests').set(asUser(token)).expect(200)).body;
  const openFor = async (token: string) => (await http(s).get('/company/open-requests').set(at(token)).expect(200)).body;
  const forProvider = async (token: string) => (await http(s).get('/company/provider-requests').set(at(token)).expect(200)).body;
  const notificationsOf = async (token: string) => (await http(s).get('/my/notifications').set(asUser(token)).expect(200)).body;
  const setPhone = (email: string, phone: string) => ownerPool.query(`update users set phone = $2 where email = $1`, [email, phone]);

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
    await setPhone('rita@email.com', '11988887777');
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  describe('confirmação', () => {
    it('move para confirmado e libera endereço completo e telefone para os dois lados', async () => {
      const joao = await ready('João Lima', 'joao@email.com');
      await setPhone('joao@email.com', '11977776666');
      const request = await createRequest();
      await accept(joao.token, request.id).expect(200);

      // Antes: o cliente vê o prestador (sem telefone); o prestador, só a visão reduzida.
      expect((await mine())[0]).toMatchObject({
        status: 'awaiting_client',
        provider: { name: 'João Lima', completedCount: 0, phone: null },
      });
      const [before] = await forProvider(joao.token);
      expect(before).toMatchObject({ status: 'awaiting_client', clientFirstName: 'Rita', details: null });
      expect(JSON.stringify(before)).not.toContain('Apto 32');
      expect(JSON.stringify(before)).not.toContain('11988887777');

      const res = await confirm(client, request.id).expect(200);
      expect(res.body).toEqual({ id: request.id, status: 'confirmed' });

      expect((await mine())[0]).toMatchObject({
        status: 'confirmed',
        provider: { name: 'João Lima', phone: '11977776666' },
      });
      const [after] = await forProvider(joao.token);
      expect(after).toMatchObject({
        status: 'confirmed',
        details: { clientName: 'Rita Souza', clientPhone: '11988887777', addressComplement: 'Apto 32', location: se },
      });
    });

    it('avisa o prestador pelo socket', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await accept(joao.token, request.id).expect(200);
      const providerSocket = await connect(url, joao.token);
      sockets.push(providerSocket);

      const notified = nextEvent<{ type: string; title: string }>(providerSocket, socketEvents.notification);
      const updated = nextEvent(providerSocket, socketEvents.serviceRequestUpdated);
      await confirm(client, request.id).expect(200);
      expect(await notified).toMatchObject({ type: 'request_confirmed', title: 'Rita confirmou você' });
      expect(await updated).toEqual({ id: request.id, companyId: admin.companyId, status: 'confirmed' });
    });

    it('só o cliente dono confirma, e só enquanto aguarda', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');

      // Ainda aberto: nada a confirmar.
      await confirm(client, request.id).expect(409);
      await accept(joao.token, request.id).expect(200);

      await confirm(bruno, request.id).expect(404);
      await confirm(joao.token, request.id).expect(404);
      await confirm(admin.token, request.id).expect(404);
      await confirm(client, request.id).expect(200);
      await confirm(client, request.id).expect(409);
      await refuse(client, request.id).expect(409);
    });

    it('conta os pedidos concluídos do prestador na empresa', async () => {
      const joao = await ready('João', 'joao@email.com');
      const antigo = await createRequest();
      await accept(joao.token, antigo.id).expect(200);
      await ownerPool.query(`update service_requests set status = 'completed' where id = $1`, [antigo.id]);

      const novo = await createRequest();
      await accept(joao.token, novo.id).expect(200);
      const pedido = (await mine()).find((r: { id: string }) => r.id === novo.id);
      expect(pedido.provider.completedCount).toBe(1);
    });
  });

  describe('recusa do cliente', () => {
    it('volta para aberto, registra a recusa e o prestador deixa de ver o pedido', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await accept(joao.token, request.id).expect(200);

      await refuse(client, request.id).expect(204);

      const [pedido] = await mine();
      expect(pedido).toMatchObject({ status: 'open', provider: null });
      const { rows } = await ownerPool.query(`select by from service_request_declines`);
      expect(rows).toEqual([{ by: 'client' }]);
      expect(await openFor(joao.token)).toEqual([]);
      expect(await forProvider(joao.token)).toEqual([]);
      await accept(joao.token, request.id).expect(404);

      expect(await notificationsOf(joao.token)).toContainEqual(
        expect.objectContaining({ type: 'request_declined', title: 'O cliente recusou seu aceite' }),
      );
    });

    it('os outros aptos são avisados de novo e podem aceitar', async () => {
      const joao = await ready('João', 'joao@email.com');
      const maria = await ready('Maria', 'maria@email.com');
      const request = await createRequest();
      await accept(joao.token, request.id).expect(200);
      expect(await openFor(maria.token)).toEqual([]);

      const mariaSocket = await connect(url, maria.token);
      sockets.push(mariaSocket);
      const notified = nextEvent<{ type: string }>(mariaSocket, socketEvents.notification);
      const listChanged = nextEvent(mariaSocket, socketEvents.openRequestsChanged);
      await refuse(client, request.id).expect(204);
      expect((await notified).type).toBe('new_request');
      expect(await listChanged).toEqual({ companyId: admin.companyId });

      const { rows } = await ownerPool.query(
        `select count(*)::int as n from notifications n join users u on u.id = n.user_id
          where n.type = 'new_request' and u.email = 'maria@email.com'`,
      );
      expect(rows[0].n).toBe(2);
      expect(await openFor(maria.token)).toHaveLength(1);
      await accept(maria.token, request.id).expect(200);
    });
  });

  describe('um pedido ativo por prestador', () => {
    it('prestador com pedido confirmado deixa de ser apto', async () => {
      const joao = await ready('João', 'joao@email.com');
      const primeiro = await createRequest();
      await accept(joao.token, primeiro.id).expect(200);
      await confirm(client, primeiro.id).expect(200);

      const segundo = await createRequest();
      expect(await openFor(joao.token)).toEqual([]);
      await accept(joao.token, segundo.id).expect(404);
    });

    it('prestador que aceitou dois pedidos: o segundo a confirmar volta para aberto, sem contar como recusa', async () => {
      const joao = await ready('João', 'joao@email.com');
      const maria = await ready('Maria', 'maria@email.com');
      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      const a = await createRequest();
      const b = await createRequest(bruno);
      await accept(joao.token, a.id).expect(200);
      await accept(joao.token, b.id).expect(200);

      await confirm(client, a.id).expect(200);
      const res = await confirm(bruno, b.id).expect(200);
      expect(res.body).toEqual({ id: b.id, status: 'open' });

      expect((await mine(bruno))[0]).toMatchObject({ status: 'open', provider: null });
      const { rows } = await ownerPool.query(`select count(*)::int as n from service_request_declines`);
      expect(rows[0].n).toBe(0);
      expect((await openFor(maria.token)).map((r: { id: string }) => r.id)).toContain(b.id);
      expect(await notificationsOf(bruno)).toContainEqual(
        expect.objectContaining({ title: 'O prestador não está mais disponível' }),
      );
    });

    it('confirmações simultâneas do mesmo prestador: só uma vence', async () => {
      const joao = await ready('João', 'joao@email.com');
      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      const a = await createRequest();
      const b = await createRequest(bruno);
      await accept(joao.token, a.id).expect(200);
      await accept(joao.token, b.id).expect(200);

      const results = await Promise.all([confirm(client, a.id), confirm(bruno, b.id)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(results.map((r) => r.body.status as string).sort((x, y) => x.localeCompare(y))).toEqual(['confirmed', 'open']);
    });
  });

  describe('isolamento entre empresas', () => {
    it('cliente e prestador de outra empresa não confirmam, não recusam e não veem o pedido', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await accept(joao.token, request.id).expect(200);

      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const deB = await clientOf(s, b, 'Rita Souza', 'rita2@email.com');
      await http(s).post(`/company/service-requests/${request.id}/confirm`).set(asUser(deB, b.companyId)).expect(404);
      await http(s).post(`/company/service-requests/${request.id}/confirm`).set(asUser(client, b.companyId)).expect(404);
      await http(s).post(`/company/service-requests/${request.id}/decline-provider`).set(asUser(deB, b.companyId)).expect(404);
      expect(await mine(deB)).toEqual([]);

      // No Postgres: a função do prestador só responde ao cliente do pedido ou a quem age na empresa dele.
      const transactions = s.app.get(TenantTransactions);
      const providerOf = (userId: string, companyId: string | null) =>
        transactions.run({ userId, companyId }, async (tx) =>
          (await tx.execute(sql`select app.request_provider(${request.id}) as provider`)).rows[0].provider,
        );
      const idOf = async (token: string) => (await http(s).get('/me').set(asUser(token)).expect(200)).body.user.id as string;
      expect(await providerOf(await idOf(deB), b.companyId)).toBeNull();
      expect(await providerOf(await idOf(deB), null)).toBeNull();
      expect(await providerOf(await idOf(b.token), b.companyId)).toBeNull();
      expect(await providerOf(await idOf(client), null)).toMatchObject({ name: 'João' });
      expect(await providerOf(await idOf(admin.token), admin.companyId)).toMatchObject({ name: 'João' });
    });
  });

  describe('telefone no cadastro', () => {
    it('é opcional, guardado só com dígitos, e rejeitado se inválido', async () => {
      await http(s)
        .post('/auth/signup')
        .send({ name: 'Com Telefone', email: 'com@email.com', password: 'senha-cliente', phone: '(11) 99999-1234' })
        .expect(201);
      const { rows } = await ownerPool.query(`select phone from users where email = 'com@email.com'`);
      expect(rows[0].phone).toBe('11999991234');

      await http(s)
        .post('/auth/signup')
        .send({ name: 'Ruim', email: 'ruim@email.com', password: 'senha-cliente', phone: '123' })
        .expect(400);
      await http(s).post('/auth/signup').send({ name: 'Sem', email: 'sem@email.com', password: 'senha-cliente' }).expect(201);
    });
  });
});
