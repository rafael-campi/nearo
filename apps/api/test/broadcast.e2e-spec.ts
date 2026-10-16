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

// Pedido na Praça da Sé; prestadores em volta, em São Paulo.
const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 }; // ~2,6 km da Sé
const santana = { latitude: -23.5025, longitude: -46.6252 }; // ~5,4 km da Sé

describe('broadcast: prestador apto vê e aceita ou recusa', () => {
  let s: Scenario;
  let url: string;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  const sockets: Socket[] = [];
  const asAdmin = () => asUser(admin.token, admin.companyId);
  const at = (token: string) => asUser(token, admin.companyId);
  const createRequest = async (token = client) =>
    (
      await http(s)
        .post('/company/service-requests')
        .set(at(token))
        .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body;
  const openFor = async (token: string) => (await http(s).get('/company/open-requests').set(at(token)).expect(200)).body;
  const ready = (name: string, email: string, options: Partial<Parameters<typeof readyProvider>[4]> = {}) =>
    readyProvider(s, admin, name, email, { categoryIds: [eletrica], base: paulista, radiusKm: 5, ...options });

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
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  describe('prestador apto', () => {
    it('só quem cumpre todas as condições vê o pedido e é avisado', async () => {
      const apto = await ready('Apto', 'apto@email.com');
      const indisponivel = await ready('Indisponível', 'indisp@email.com', { available: false });
      const pintura = await categoryOf(s, admin, 'Pintura');
      const outraCategoria = await ready('Pintor', 'pintor@email.com', { categoryIds: [pintura] });
      const longe = await ready('Longe', 'longe@email.com', { base: santana, radiusKm: 5 });
      const semEndereco = await ready('Sem endereço', 'sem@email.com', { base: null });
      const desativado = await ready('Desativado', 'desativado@email.com');
      await http(s).patch(`/company/providers/${desativado.membershipId}`).set(asAdmin()).send({ active: false }).expect(200);

      const request = await createRequest();

      expect((await openFor(apto.token)).map((r: { id: string }) => r.id)).toEqual([request.id]);
      for (const other of [indisponivel, outraCategoria, longe, semEndereco]) {
        expect(await openFor(other.token)).toEqual([]);
      }

      const { rows } = await ownerPool.query(
        `select u.email from notifications n join users u on u.id = n.user_id where n.type = 'new_request'`,
      );
      expect(rows.map((r) => r.email)).toEqual(['apto@email.com']);
    });

    it('raio maior alcança o pedido mais longe', async () => {
      const longe = await ready('Longe', 'longe@email.com', { base: santana, radiusKm: 10 });
      const request = await createRequest();
      expect((await openFor(longe.token))[0]).toMatchObject({ id: request.id });
    });

    it('quem criou o pedido não é apto para ele, mesmo sendo prestador da empresa', async () => {
      const rita = await ready('Rita Souza', 'rita@email.com', { password: 'senha-cliente' });
      await createRequest(client);
      expect(await openFor(rita.token)).toEqual([]);
    });

    it('visão reduzida: sem endereço completo, coordenadas nem telefone; com distância e primeiro nome', async () => {
      const apto = await ready('Apto', 'apto@email.com');
      const request = await createRequest();
      const [open] = await openFor(apto.token);
      expect(open).toEqual({
        id: request.id,
        companyId: admin.companyId,
        categoryName: 'Elétrica',
        description: 'Tomada da cozinha soltando faísca',
        neighborhood: 'Sé',
        distanceKm: expect.closeTo(2.6, 0),
        clientFirstName: 'Rita',
        assigned: false,
        createdAt: expect.any(String),
      });
      expect(JSON.stringify(open)).not.toContain('Apto 32');
    });
  });

  describe('aceite', () => {
    it('move para aguardando cliente, avisa o cliente e some da lista dos outros', async () => {
      const joao = await ready('João Lima', 'joao@email.com');
      const maria = await ready('Maria', 'maria@email.com');
      const request = await createRequest();

      const res = await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(200);
      expect(res.body).toEqual({ id: request.id, status: 'awaiting_client' });

      expect(await openFor(maria.token)).toEqual([]);
      const mine = (await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body;
      expect(mine[0].status).toBe('awaiting_client');
      const notifications = (await http(s).get('/my/notifications').set(asUser(client)).expect(200)).body;
      expect(notifications[0]).toMatchObject({
        type: 'request_accepted',
        title: 'João aceitou seu pedido',
        serviceRequestId: request.id,
        companyName: 'Elétrica Silva',
        readAt: null,
      });
    });

    it('dois aceites simultâneos: só um vence; o outro recebe "pedido não está mais disponível"', async () => {
      const joao = await ready('João', 'joao@email.com');
      const maria = await ready('Maria', 'maria@email.com');
      const request = await createRequest();

      const results = await Promise.all(
        [joao, maria].map((p) => http(s).post(`/company/service-requests/${request.id}/accept`).set(at(p.token))),
      );
      expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.message).toBe('Pedido não está mais disponível');
    });

    it('quem não é apto não aceita', async () => {
      const longe = await ready('Longe', 'longe@email.com', { base: santana, radiusKm: 1 });
      const request = await createRequest();
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(longe.token)).expect(404);
    });
  });

  describe('recusa', () => {
    it('é registrada e o prestador deixa de ver o pedido; os outros continuam vendo', async () => {
      const joao = await ready('João', 'joao@email.com');
      const maria = await ready('Maria', 'maria@email.com');
      const request = await createRequest();

      await http(s).post(`/company/service-requests/${request.id}/decline`).set(at(joao.token)).expect(204);
      expect(await openFor(joao.token)).toEqual([]);
      expect(await openFor(maria.token)).toHaveLength(1);
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(404);

      const { rows } = await ownerPool.query(`select by from service_request_declines`);
      expect(rows).toEqual([{ by: 'provider' }]);
    });
  });

  describe('tempo real (Socket.IO)', () => {
    it('prestador apto recebe a atualização do pedido novo; cliente recebe a mudança de status no aceite', async () => {
      const joao = await ready('João', 'joao@email.com');
      const providerSocket = await connect(url, joao.token);
      const clientSocket = await connect(url, client);
      sockets.push(providerSocket, clientSocket);

      const notified = nextEvent<{ type: string; title: string; body: string }>(providerSocket, socketEvents.notification);
      const listChanged = nextEvent(providerSocket, socketEvents.openRequestsChanged);
      const request = await createRequest();
      expect(await notified).toMatchObject({ type: 'new_request', title: 'Pedido novo: Elétrica', body: 'Sé · a 2,6 km de você' });
      expect(await listChanged).toEqual({ companyId: admin.companyId });

      const updated = nextEvent(clientSocket, socketEvents.serviceRequestUpdated);
      const accepted = nextEvent<{ type: string }>(clientSocket, socketEvents.notification);
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(200);
      expect(await updated).toEqual({ id: request.id, companyId: admin.companyId, status: 'awaiting_client' });
      expect((await accepted).type).toBe('request_accepted');
    });

    it('token inválido não conecta', async () => {
      await expect(connect(url, 'token-inventado')).rejects.toThrow('Não autenticado');
    });

    it('acompanhar um pedido: cliente, prestador e admin podem; outra pessoa não', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(200);
      const stranger = await clientOf(s, admin, 'Bruno', 'bruno@email.com');

      for (const [token, ok] of [
        [client, true],
        [joao.token, true],
        [admin.token, true],
        [stranger, false],
      ] as const) {
        const socket = await connect(url, token);
        sockets.push(socket);
        const ack = await socket.emitWithAck(socketEvents.subscribeServiceRequest, { serviceRequestId: request.id });
        expect(ack).toEqual({ ok });
      }
    });
  });

  it('lista de atualizações e marcar como lidas', async () => {
    const joao = await ready('João', 'joao@email.com');
    await createRequest();
    await createRequest();
    const list = (await http(s).get('/my/notifications').set(asUser(joao.token)).expect(200)).body;
    expect(list).toHaveLength(2);
    await http(s).post('/my/notifications/read').set(asUser(joao.token)).expect(204);
    const read = (await http(s).get('/my/notifications').set(asUser(joao.token)).expect(200)).body;
    expect(read.every((n: { readAt: string | null }) => n.readAt !== null)).toBe(true);
  });

  describe('isolamento entre empresas', () => {
    it('prestador de outra empresa não vê, não aceita e não é avisado', async () => {
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const eletricaB = await categoryOf(s, b, 'Elétrica');
      const deB = await readyProvider(s, b, 'Carlos', 'carlos@email.com', { categoryIds: [eletricaB], base: paulista });
      const request = await createRequest();

      expect((await http(s).get('/company/open-requests').set(asUser(deB.token, b.companyId)).expect(200)).body).toEqual([]);
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(asUser(deB.token, b.companyId)).expect(404);
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(asUser(deB.token, admin.companyId)).expect(404);
      expect((await http(s).get('/my/notifications').set(asUser(deB.token)).expect(200)).body).toEqual([]);
    });

    it('RLS: recusas e atualizações de uma empresa não aparecem para outra; atualização é só do dono', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await http(s).post(`/company/service-requests/${request.id}/decline`).set(at(joao.token)).expect(204);

      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const meB = (await http(s).get('/me').set(asUser(b.token)).expect(200)).body;
      const transactions = s.app.get(TenantTransactions);
      const asB = { userId: meB.user.id as string, companyId: b.companyId };
      expect(await transactions.run(asB, async (tx) => (await tx.execute(sql`select * from service_request_declines`)).rows)).toEqual([]);

      // O admin da própria empresa também não lê as atualizações dos outros.
      const meA = (await http(s).get('/me').set(asUser(admin.token)).expect(200)).body;
      const asA = { userId: meA.user.id as string, companyId: admin.companyId };
      expect(await transactions.run(asA, async (tx) => (await tx.execute(sql`select * from notifications`)).rows)).toEqual([]);
    });
  });
});
