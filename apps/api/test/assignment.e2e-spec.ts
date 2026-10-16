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

const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 }; // ~2,6 km da Sé
const liberdade = { latitude: -23.5588, longitude: -46.6358 }; // ~1 km da Sé
const santana = { latitude: -23.5025, longitude: -46.6252 }; // ~5,4 km da Sé

describe('modo de atribuição e atribuição manual', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  const asAdmin = () => asUser(admin.token, admin.companyId);
  const at = (token: string) => asUser(token, admin.companyId);
  const setMode = (assignmentMode: 'manual' | 'broadcast') =>
    http(s).patch('/company/settings').set(asAdmin()).send({ assignmentMode }).expect(200);
  const createRequest = async () =>
    (
      await http(s)
        .post('/company/service-requests')
        .set(at(client))
        .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body;
  const ready = (name: string, email: string, base = paulista) =>
    readyProvider(s, admin, name, email, { categoryIds: [eletrica], base, radiusKm: 5 });
  const openFor = async (token: string) => (await http(s).get('/company/open-requests').set(at(token)).expect(200)).body;
  const assign = (requestId: string, membershipId: string) =>
    http(s).post(`/company/service-requests/${requestId}/assign`).set(asAdmin()).send({ providerMembershipId: membershipId });
  const notificationsOf = async (token: string) => (await http(s).get('/my/notifications').set(asUser(token)).expect(200)).body;
  const types = (list: { type: string }[]) => list.map((n) => n.type);

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    s.mailer.sent.length = 0;
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    eletrica = await categoryOf(s, admin, 'Elétrica');
    client = await clientOf(s, admin, 'Rita Souza', 'rita@email.com');
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  describe('modo da empresa', () => {
    it('começa em broadcast; o admin troca; cliente e prestador não', async () => {
      expect((await http(s).get('/company').set(asAdmin()).expect(200)).body).toMatchObject({ assignmentMode: 'broadcast' });
      expect((await setMode('manual')).body).toMatchObject({ assignmentMode: 'manual' });
      expect((await http(s).get('/company').set(asAdmin()).expect(200)).body.assignmentMode).toBe('manual');

      const joao = await ready('João', 'joao@email.com');
      await http(s).patch('/company/settings').set(at(client)).send({ assignmentMode: 'broadcast' }).expect(404);
      await http(s).patch('/company/settings').set(at(joao.token)).send({ assignmentMode: 'broadcast' }).expect(404);
      await http(s).patch('/company/settings').set(asAdmin()).send({ assignmentMode: 'outro' }).expect(400);
    });

    it('manual: o admin é notificado na criação e os prestadores não são avisados nem veem o pedido', async () => {
      await setMode('manual');
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();

      expect(await openFor(joao.token)).toEqual([]);
      expect(await notificationsOf(joao.token)).toEqual([]);
      const adminNotifications = await notificationsOf(admin.token);
      expect(adminNotifications).toHaveLength(1);
      expect(adminNotifications[0]).toMatchObject({
        type: 'request_needs_assignment',
        title: 'Pedido novo para atribuir: Elétrica',
        serviceRequestId: request.id,
      });
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(404);
    });

    it('o modo só afeta a criação: pedido criado em broadcast continua visível depois de trocar para manual', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await setMode('manual');
      expect((await openFor(joao.token)).map((r: { id: string }) => r.id)).toEqual([request.id]);
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(200);
    });
  });

  describe('atribuição', () => {
    it('o admin vê os aptos, atribui, e o prestador aceita; o aceite vai para aguardando cliente', async () => {
      await setMode('manual');
      const joao = await ready('João', 'joao@email.com', liberdade);
      const maria = await ready('Maria', 'maria@email.com');
      await ready('Longe', 'longe@email.com', santana).then(() => undefined);
      const request = await createRequest();

      const eligible = (await http(s).get(`/company/service-requests/${request.id}/eligible-providers`).set(asAdmin()).expect(200)).body;
      expect(eligible.map((e: { name: string }) => e.name)).toEqual(['João', 'Maria']);
      expect(eligible[0]).toEqual({ membershipId: joao.membershipId, name: 'João', distanceKm: expect.any(Number) });

      const res = await assign(request.id, maria.membershipId).expect(200);
      expect(res.body).toEqual({ id: request.id, status: 'assigned' });

      // Só o prestador escolhido vê, com a marca de atribuído, e é avisado.
      expect(await openFor(joao.token)).toEqual([]);
      expect(await openFor(maria.token)).toEqual([expect.objectContaining({ id: request.id, assigned: true, clientFirstName: 'Rita' })]);
      expect(types(await notificationsOf(maria.token))).toEqual(['request_assigned']);
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(404);
      expect((await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body[0].status).toBe('assigned');

      const accepted = await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(maria.token)).expect(200);
      expect(accepted.body.status).toBe('awaiting_client');
      expect((await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body[0].provider).toMatchObject({ name: 'Maria' });
    });

    it('só para prestador apto, e só para pedido aberto', async () => {
      await setMode('manual');
      const longe = await ready('Longe', 'longe@email.com', santana).then(async (p) => {
        await http(s).patch('/company/provider-profile').set(at(p.token)).send({ serviceRadiusKm: 1 }).expect(200);
        return p;
      });
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();

      const res = await assign(request.id, longe.membershipId).expect(400);
      expect(res.body.issues[0].path).toBe('providerMembershipId');
      await assign(request.id, joao.membershipId).expect(200);
      await assign(request.id, joao.membershipId).expect(409);
      await http(s).post(`/company/service-requests/${request.id}/assign`).set(at(joao.token)).send({ providerMembershipId: joao.membershipId }).expect(404);
      expect(
        (await http(s).get(`/company/service-requests/${request.id}/eligible-providers`).set(asAdmin()).expect(200)).body,
      ).toEqual([]);
    });

    it('em broadcast o admin também pode atribuir um pedido aberto', async () => {
      const joao = await ready('João', 'joao@email.com');
      const maria = await ready('Maria', 'maria@email.com');
      const request = await createRequest();
      expect(await openFor(maria.token)).toHaveLength(1);

      await assign(request.id, joao.membershipId).expect(200);
      expect(await openFor(maria.token)).toEqual([]);
      expect(await openFor(joao.token)).toEqual([expect.objectContaining({ assigned: true })]);
    });
  });

  describe('recusa e volta para aberto', () => {
    it('recusa da atribuição: volta para aberto e o admin é notificado de novo (manual); o admin vê quem recusou e quando', async () => {
      await setMode('manual');
      const joao = await ready('João', 'joao@email.com');
      const maria = await ready('Maria', 'maria@email.com');
      const request = await createRequest();
      await assign(request.id, joao.membershipId).expect(200);

      await http(s).post(`/company/service-requests/${request.id}/decline`).set(at(joao.token)).expect(204);

      expect((await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body[0]).toMatchObject({ status: 'open', provider: null });
      expect(types(await notificationsOf(admin.token))).toEqual(['request_needs_assignment', 'request_needs_assignment']);
      expect(await openFor(maria.token)).toEqual([]);

      const declines = (await http(s).get(`/company/service-requests/${request.id}/declines`).set(asAdmin()).expect(200)).body;
      expect(declines).toEqual([{ providerName: 'João', by: 'provider', createdAt: expect.any(String) }]);
      // João não é mais apto; Maria é.
      const eligible = (await http(s).get(`/company/service-requests/${request.id}/eligible-providers`).set(asAdmin()).expect(200)).body;
      expect(eligible.map((e: { name: string }) => e.name)).toEqual(['Maria']);
    });

    it('em broadcast, a recusa da atribuição avisa os aptos de novo; o admin não é notificado', async () => {
      const joao = await ready('João', 'joao@email.com');
      const maria = await ready('Maria', 'maria@email.com');
      const request = await createRequest();
      await assign(request.id, joao.membershipId).expect(200);
      await http(s).post(`/company/service-requests/${request.id}/decline`).set(at(joao.token)).expect(204);

      expect(await openFor(maria.token)).toEqual([expect.objectContaining({ id: request.id, assigned: false })]);
      expect(types(await notificationsOf(maria.token))).toEqual(['new_request', 'new_request']);
      expect(await notificationsOf(admin.token)).toEqual([]);
    });

    it('o admin vê também a recusa do cliente ao prestador', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(200);
      await http(s).post(`/company/service-requests/${request.id}/decline-provider`).set(at(client)).expect(204);

      const declines = (await http(s).get(`/company/service-requests/${request.id}/declines`).set(asAdmin()).expect(200)).body;
      expect(declines).toEqual([{ providerName: 'João', by: 'client', createdAt: expect.any(String) }]);
    });

    it('manual: pedido que volta para aberto depois da recusa do cliente notifica o admin', async () => {
      await setMode('manual');
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await assign(request.id, joao.membershipId).expect(200);
      await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(200);
      await http(s).post(`/company/service-requests/${request.id}/decline-provider`).set(at(client)).expect(204);

      const list = await notificationsOf(admin.token);
      expect(types(list)).toEqual(['request_needs_assignment', 'request_needs_assignment']);
      expect(list.map((n: { title: string }) => n.title)).toContain('Pedido voltou para aberto: Elétrica');
      expect(await openFor(joao.token)).toEqual([]);
    });
  });

  describe('isolamento entre empresas', () => {
    it('admin de outra empresa não atribui nem lê aptos e recusas', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const asB = asUser(b.token, b.companyId);

      await http(s).post(`/company/service-requests/${request.id}/assign`).set(asB).send({ providerMembershipId: joao.membershipId }).expect(404);
      await http(s).get(`/company/service-requests/${request.id}/eligible-providers`).set(asB).expect(404);
      await http(s).get(`/company/service-requests/${request.id}/declines`).set(asB).expect(404);
      await http(s).patch('/company/settings').set(asB).send({ assignmentMode: 'manual' }).expect(200);
      expect((await http(s).get('/company').set(asAdmin()).expect(200)).body.assignmentMode).toBe('broadcast');
    });
  });
});
