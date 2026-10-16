import { CompaniesService } from '../src/companies/companies.service.js';
import { ownerPool, resetState } from './support/db.js';
import { testEnv } from './support/env.js';
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
import { Redis } from 'ioredis';

const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 };
const REASON = 'Resolvi de outro jeito';

describe('cancelamento e desistência', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  let joao: { token: string; membershipId: string };
  const redis = new Redis(testEnv.REDIS_URL);
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
  /** Leva um pedido novo até o status pedido, pelo caminho normal. */
  const requestAt = async (status: 'open' | 'assigned' | 'awaiting_client' | 'confirmed' | 'en_route' | 'arrived' | 'in_progress' | 'completed') => {
    const request = await createRequest();
    if (status === 'open') return request;
    if (status === 'assigned') {
      await http(s).post(`/company/service-requests/${request.id}/assign`).set(asAdmin()).send({ providerMembershipId: joao.membershipId }).expect(200);
      return request;
    }
    await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(200);
    if (status === 'awaiting_client') return request;
    await http(s).post(`/company/service-requests/${request.id}/confirm`).set(at(client)).expect(200);
    for (const step of ['en_route', 'arrived', 'in_progress', 'completed']) {
      if (status === 'confirmed') break;
      await http(s).post(`/company/service-requests/${request.id}/status`).set(at(joao.token)).send({ status: step }).expect(200);
      if (step === status) break;
    }
    return request;
  };
  // `null` envia o corpo sem motivo.
  const body = (reason: string | null) => (reason === null ? {} : { reason });
  const cancel = (token: string, id: string, reason: string | null = REASON) =>
    http(s).post(`/company/service-requests/${id}/cancel`).set(at(token)).send(body(reason));
  const adminCancel = (id: string, reason: string | null = 'Pedido duplicado') =>
    http(s).post(`/company/service-requests/${id}/admin-cancel`).set(asAdmin()).send(body(reason));
  const withdraw = (token: string, id: string, reason: string | null = 'Imprevisto na estrada') =>
    http(s).post(`/company/service-requests/${id}/withdraw`).set(at(token)).send(body(reason));
  const one = async (id: string) => (await http(s).get(`/company/service-requests/${id}`).set(asAdmin()).expect(200)).body;
  const events = async (id: string) => (await http(s).get(`/company/service-requests/${id}/events`).set(asAdmin()).expect(200)).body;
  const typesOf = async (token: string) =>
    (await http(s).get('/my/notifications').set(asUser(token)).expect(200)).body.map((n: { type: string }) => n.type);
  const openFor = async (token: string) => (await http(s).get('/company/open-requests').set(at(token)).expect(200)).body;

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    s.mailer.sent.length = 0;
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    eletrica = await categoryOf(s, admin, 'Elétrica');
    client = await clientOf(s, admin, 'Rita Souza', 'rita@email.com');
    joao = await readyProvider(s, admin, 'João Lima', 'joao@email.com', { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
  });

  afterAll(async () => {
    await redis.quit();
    await s.close();
    await ownerPool.end();
  });

  describe('cancelamento pelo cliente', () => {
    it.each(['open', 'assigned', 'awaiting_client', 'confirmed', 'en_route'] as const)('cancela um pedido %s', async (status) => {
      const request = await requestAt(status);
      await cancel(client, request.id).expect(204);
      const cancelled = await one(request.id);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancellation).toEqual({ byRole: 'client', reason: REASON, at: expect.any(String) });
      // O cliente também vê o motivo na sua lista.
      const mine = (await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body;
      expect(mine[0]).toMatchObject({ status: 'cancelled', cancellation: { byRole: 'client', reason: REASON } });
    });

    it('depois de "chegou" não cancela; só o admin', async () => {
      for (const status of ['arrived', 'in_progress'] as const) {
        const request = await requestAt(status);
        const res = await cancel(client, request.id).expect(409);
        expect(res.body.message).toBe('O prestador já chegou: só a empresa pode cancelar');
        expect((await one(request.id)).status).toBe(status);
        await adminCancel(request.id).expect(204);
        await http(s).post(`/company/service-requests/${request.id}/status`).set(at(joao.token)).send({ status: 'completed' }).expect(409);
        // libera o prestador para o próximo pedido da repetição
      }
    });

    it('concluído e já cancelado não cancelam de novo; motivo é obrigatório', async () => {
      const done = await requestAt('completed');
      await cancel(client, done.id).expect(409);
      const request = await createRequest();
      await cancel(client, request.id, '').expect(400);
      await cancel(client, request.id, null).expect(400);
      await cancel(client, request.id).expect(204);
      await cancel(client, request.id).expect(409);
    });

    it('avisa o prestador envolvido e o libera; pedido cancelado some das listas', async () => {
      const request = await requestAt('confirmed');
      const other = await createRequest();
      expect(await openFor(joao.token)).toEqual([]); // ocupado

      await cancel(client, request.id).expect(204);
      expect(await typesOf(joao.token)).toContain('request_cancelled');
      // Prestador livre outra vez: vê o outro pedido, e o cancelado não aparece.
      expect((await openFor(joao.token)).map((r: { id: string }) => r.id)).toEqual([other.id]);
      const provided = (await http(s).get('/company/provider-requests').set(at(joao.token)).expect(200)).body;
      expect(provided).toEqual([]);
    });

    it('a caminho: a última posição deixa de ser exposta', async () => {
      const request = await requestAt('en_route');
      await http(s).post(`/company/service-requests/${request.id}/location`).set(at(joao.token)).send(paulista).expect(204);
      expect(await redis.get(`gps:last:${request.id}`)).not.toBeNull();
      await cancel(client, request.id).expect(204);
      expect(await redis.get(`gps:last:${request.id}`)).toBeNull();
    });

    it('só o cliente dono cancela', async () => {
      const request = await createRequest();
      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      await cancel(bruno, request.id).expect(404);
      await cancel(joao.token, request.id).expect(404);
      await cancel(admin.token, request.id).expect(404);
    });
  });

  describe('cancelamento pelo admin', () => {
    it.each(['open', 'assigned', 'awaiting_client', 'confirmed', 'en_route', 'arrived', 'in_progress'] as const)(
      'cancela um pedido %s, avisa o cliente e guarda quem e por quê',
      async (status) => {
        const request = await requestAt(status);
        await adminCancel(request.id, 'Fora da área de cobertura').expect(204);
        expect((await one(request.id)).cancellation).toEqual({ byRole: 'admin', reason: 'Fora da área de cobertura', at: expect.any(String) });
        expect(await typesOf(client)).toContain('request_cancelled');
        expect(await events(request.id)).toEqual([
          { kind: 'cancellation', byRole: 'admin', byName: 'Admin Elétrica Silva', reason: 'Fora da área de cobertura', createdAt: expect.any(String) },
        ]);
      },
    );

    it('não cancela pedido concluído; cliente e prestador não usam essa rota', async () => {
      const done = await requestAt('completed');
      await adminCancel(done.id).expect(409);
      const request = await createRequest();
      await http(s).post(`/company/service-requests/${request.id}/admin-cancel`).set(at(client)).send({ reason: REASON }).expect(404);
      await http(s).post(`/company/service-requests/${request.id}/admin-cancel`).set(at(joao.token)).send({ reason: REASON }).expect(404);
    });

    it('o prestador do pedido é avisado e o histórico mostra quem cancelou', async () => {
      const request = await requestAt('confirmed');
      await adminCancel(request.id).expect(204);
      expect(await typesOf(joao.token)).toContain('request_cancelled');
      await cancel(client, request.id).expect(409);
    });
  });

  describe('desistência do prestador', () => {
    it.each(['confirmed', 'en_route'] as const)('em %s volta para aberto, conta como recusa e avisa o cliente', async (status) => {
      const maria = await readyProvider(s, admin, 'Maria', 'maria@email.com', { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
      const request = await requestAt(status);
      await withdraw(joao.token, request.id).expect(204);

      const mine = (await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body[0];
      expect(mine).toMatchObject({ status: 'open', provider: null });
      expect(await typesOf(client)).toContain('request_withdrawn');
      const { rows } = await ownerPool.query(`select by from service_request_declines`);
      expect(rows).toEqual([{ by: 'provider' }]);
      expect(await events(request.id)).toEqual([
        { kind: 'withdrawal', byRole: 'provider', byName: 'João Lima', reason: 'Imprevisto na estrada', createdAt: expect.any(String) },
      ]);
      // Os outros aptos são avisados de novo; quem desistiu não vê o pedido de volta.
      expect(await openFor(maria.token)).toHaveLength(1);
      expect(await openFor(joao.token)).toEqual([]);
      expect(await redis.get(`gps:last:${request.id}`)).toBeNull();
    });

    it('não desiste depois de "chegou", nem pedido de outro, nem sem motivo', async () => {
      const maria = await readyProvider(s, admin, 'Maria', 'maria@email.com', { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
      const arrived = await requestAt('arrived');
      await withdraw(joao.token, arrived.id).expect(409);
      await withdraw(maria.token, arrived.id).expect(404);
      await withdraw(client, arrived.id).expect(404);
      await adminCancel(arrived.id).expect(204);

      const confirmed = await requestAt('confirmed');
      await withdraw(joao.token, confirmed.id, '').expect(400);
      await withdraw(joao.token, confirmed.id, null).expect(400);
    });

    it('manual: o admin é notificado de que o pedido voltou para aberto', async () => {
      const request = await requestAt('confirmed');
      await http(s).patch('/company/settings').set(asAdmin()).send({ assignmentMode: 'manual' }).expect(200);
      await withdraw(joao.token, request.id).expect(204);
      expect(await typesOf(admin.token)).toEqual(['request_needs_assignment']);
    });
  });

  describe('prestador desativado', () => {
    it.each(['assigned', 'awaiting_client', 'confirmed', 'en_route', 'arrived', 'in_progress'] as const)(
      'com pedido %s, ele volta para aberto como desistência "desativado pelo admin"',
      async (status) => {
        const request = await requestAt(status);
        await http(s).patch(`/company/providers/${joao.membershipId}`).set(asAdmin()).send({ active: false }).expect(200);

        const mine = (await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body[0];
        expect(mine).toMatchObject({ status: 'open', provider: null });
        expect(await typesOf(client)).toContain('request_withdrawn');
        expect(await events(request.id)).toEqual([
          { kind: 'withdrawal', byRole: 'admin', byName: 'Admin Elétrica Silva', reason: 'desativado pelo admin', createdAt: expect.any(String) },
        ]);
        const { rows } = await ownerPool.query(`select by from service_request_declines`);
        expect(rows).toEqual([{ by: 'provider' }]);
      },
    );

    it('desativar quem não tem pedido não faz nada além de desativar', async () => {
      const request = await createRequest();
      await http(s).patch(`/company/providers/${joao.membershipId}`).set(asAdmin()).send({ active: false }).expect(200);
      expect((await one(request.id)).status).toBe('open');
      expect(await events(request.id)).toEqual([]);
    });
  });

  describe('empresa desativada', () => {
    it('pedidos não concluídos viram cancelados com o motivo "empresa desativada"; concluídos ficam', async () => {
      const done = await requestAt('completed');
      const confirmed = await requestAt('confirmed');
      const open = await createRequest();
      const rita2 = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      const other = await createRequest(rita2);

      const cancelled = await s.platform.get(CompaniesService).deactivate(admin.companyId);
      expect(cancelled).toBe(3);
      const { rows } = await ownerPool.query(
        `select id, status, cancelled_by_role, cancel_reason from service_requests order by created_at`,
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[done.id]).toMatchObject({ status: 'completed', cancel_reason: null });
      for (const id of [confirmed.id, open.id, other.id]) {
        expect(byId[id]).toMatchObject({ status: 'cancelled', cancelled_by_role: 'system', cancel_reason: 'empresa desativada' });
      }
      expect(await typesOf(client)).toContain('request_cancelled');
      expect(await typesOf(joao.token)).toContain('request_cancelled');
      // A empresa deixou de existir para as pessoas.
      const me = (await http(s).get('/me').set(asUser(client)).expect(200)).body;
      expect(me.memberships).toEqual([]);
    });
  });

  describe('isolamento entre empresas', () => {
    it('admin e cliente de outra empresa não cancelam nem leem o histórico', async () => {
      const request = await requestAt('confirmed');
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const deB = await clientOf(s, b, 'Bruno B', 'brunob@email.com');
      const asB = asUser(b.token, b.companyId);
      await http(s).post(`/company/service-requests/${request.id}/admin-cancel`).set(asB).send({ reason: REASON }).expect(404);
      await http(s).get(`/company/service-requests/${request.id}/events`).set(asB).expect(404);
      await http(s).post(`/company/service-requests/${request.id}/cancel`).set(asUser(deB, b.companyId)).send({ reason: REASON }).expect(404);
      await http(s).post(`/company/service-requests/${request.id}/cancel`).set(asUser(client, b.companyId)).send({ reason: REASON }).expect(404);
      expect((await one(request.id)).status).toBe('confirmed');
    });
  });
});
