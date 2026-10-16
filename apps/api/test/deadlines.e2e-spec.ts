import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { DeadlineScheduler } from '../src/deadlines/deadline-scheduler.js';
import { DeadlinesService } from '../src/deadlines/deadlines.service.js';
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

const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 };
const MINUTE = 60_000;

describe('prazos do pedido', () => {
  let s: Scenario;
  let deadlines: DeadlinesService;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  const asAdmin = () => asUser(admin.token, admin.companyId);
  const at = (token: string) => asUser(token, admin.companyId);
  const createRequest = async () =>
    (
      await http(s)
        .post('/company/service-requests')
        .set(at(client))
        .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body;
  const ready = (name: string, email: string) =>
    readyProvider(s, admin, name, email, { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
  const accept = (token: string, id: string) => http(s).post(`/company/service-requests/${id}/accept`).set(at(token));
  const notificationsOf = async (token: string) => (await http(s).get('/my/notifications').set(asUser(token)).expect(200)).body;
  const typesOf = async (token: string) => (await notificationsOf(token)).map((n: { type: string }) => n.type);
  const statusOf = async (id: string) =>
    (await http(s).get(`/company/service-requests/${id}`).set(asAdmin()).expect(200)).body.status as string;
  const advance = async (minutes: number) => {
    s.clock.advance(minutes * MINUTE);
    return deadlines.runDue();
  };
  const pending = () => s.app.get(DeadlineScheduler).pending();

  beforeAll(async () => {
    s = await createScenario();
    deadlines = s.app.get(DeadlinesService);
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

  describe('broadcast sem aceite em 15 minutos', () => {
    it('agenda um job atrasado no BullMQ de 15 minutos', async () => {
      await createRequest();
      const queue = new Queue('deadlines', { connection: new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: null }) });
      try {
        const delayed = await queue.getDelayed();
        expect(delayed).toHaveLength(1);
        expect(delayed[0].name).toBe('no_acceptance');
        expect(delayed[0].opts.delay).toBe(15 * MINUTE);
      } finally {
        await queue.close();
      }
    });

    it('avisa o admin aos 15 min e o pedido continua aberto, sem cancelamento automático', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();

      expect(await advance(14)).toBe(0);
      expect(await typesOf(admin.token)).toEqual([]);

      expect(await advance(1)).toBe(1);
      const list = await notificationsOf(admin.token);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ type: 'request_unclaimed', title: 'Pedido sem aceite há 15 minutos: Elétrica', serviceRequestId: request.id });

      expect(await statusOf(request.id)).toBe('open');
      expect((await http(s).get('/company/open-requests').set(at(joao.token)).expect(200)).body).toHaveLength(1);
      expect(await advance(60)).toBe(0);
      expect(await statusOf(request.id)).toBe('open');
    });

    it('não age se o pedido já mudou', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await accept(joao.token, request.id).expect(200);
      await advance(15);
      expect(await typesOf(admin.token)).toEqual([]);
    });

    it('pedido que volta para aberto ganha um prazo novo; o antigo não age', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      s.clock.advance(MINUTE);
      await accept(joao.token, request.id).expect(200);
      await http(s).post(`/company/service-requests/${request.id}/decline-provider`).set(at(client)).expect(204);
      // Reaberto em t+1 min: o prazo do t+0 é do estado antigo.
      await advance(14); // t+15
      expect(await typesOf(admin.token)).toEqual([]);
      await advance(1); // t+16
      expect(await typesOf(admin.token)).toEqual(['request_unclaimed']);
    });

    it('no modo manual não há esse prazo: o admin já foi avisado da criação', async () => {
      await http(s).patch('/company/settings').set(asAdmin()).send({ assignmentMode: 'manual' }).expect(200);
      await createRequest();
      expect(await pending()).toEqual([]);
      await advance(30);
      expect(await typesOf(admin.token)).toEqual(['request_needs_assignment']);
    });
  });

  describe('aguardando o cliente', () => {
    it('lembrete aos 5 min e, aos 10 min, volta para aberto sem contar como recusa; o prestador aceita de novo', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await accept(joao.token, request.id).expect(200);
      expect((await pending()).map((j) => j.kind).sort((a, b) => a.localeCompare(b))).toEqual([
        'awaiting_client_reminder',
        'awaiting_client_timeout',
        'no_acceptance',
      ]);

      expect(await advance(4)).toBe(0);
      expect(await advance(1)).toBe(1);
      expect(await typesOf(client)).toContain('request_reminder');
      expect(await statusOf(request.id)).toBe('awaiting_client');

      expect(await advance(5)).toBe(1);
      expect(await statusOf(request.id)).toBe('open');
      const [pedido] = (await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body;
      expect(pedido).toMatchObject({ status: 'open', provider: null });
      expect((await ownerPool.query(`select count(*)::int as n from service_request_declines`)).rows[0].n).toBe(0);
      expect(await typesOf(client)).toContain('request_expired');
      expect(await typesOf(joao.token)).toContain('request_expired');

      // O prestador continua apto: é avisado de novo e pode aceitar.
      expect((await http(s).get('/company/open-requests').set(at(joao.token)).expect(200)).body).toHaveLength(1);
      await accept(joao.token, request.id).expect(200);
      expect(await statusOf(request.id)).toBe('awaiting_client');
    });

    it('cliente que confirma a tempo não é afetado pelo prazo', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      await accept(joao.token, request.id).expect(200);
      await advance(3);
      await http(s).post(`/company/service-requests/${request.id}/confirm`).set(at(client)).expect(200);
      await advance(20);
      expect(await statusOf(request.id)).toBe('confirmed');
      expect(await typesOf(client)).not.toContain('request_reminder');
      expect(await typesOf(client)).not.toContain('request_expired');
    });

    it('cliente que recusa não recebe lembrete nem expiração do aceite antigo', async () => {
      const joao = await ready('João', 'joao@email.com');
      const maria = await ready('Maria', 'maria@email.com');
      const request = await createRequest();
      await accept(joao.token, request.id).expect(200);
      await advance(1);
      await http(s).post(`/company/service-requests/${request.id}/decline-provider`).set(at(client)).expect(204);
      await accept(maria.token, request.id).expect(200); // novo aceite, 1 min depois

      await advance(9); // t+10: vence o prazo do aceite do João, que já não vale
      expect(await statusOf(request.id)).toBe('awaiting_client');
      await advance(1); // t+11: vence o do aceite da Maria
      expect(await statusOf(request.id)).toBe('open');
    });

    it('manual: ao expirar, o admin é notificado de que o pedido voltou para aberto', async () => {
      await http(s).patch('/company/settings').set(asAdmin()).send({ assignmentMode: 'manual' }).expect(200);
      const joao = await ready('João', 'joao@email.com');
      const request = await createRequest();
      const eligible = (await http(s).get(`/company/service-requests/${request.id}/eligible-providers`).set(asAdmin()).expect(200)).body;
      await http(s).post(`/company/service-requests/${request.id}/assign`).set(asAdmin()).send({ providerMembershipId: eligible[0].membershipId }).expect(200);
      await accept(joao.token, request.id).expect(200);

      await advance(10);
      expect(await statusOf(request.id)).toBe('open');
      expect(await typesOf(admin.token)).toEqual(['request_needs_assignment', 'request_needs_assignment']);
    });
  });

  it('prazos de outra empresa não afetam esta', async () => {
    const joao = await ready('João', 'joao@email.com');
    const request = await createRequest();
    await accept(joao.token, request.id).expect(200);
    const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
    await advance(10);
    expect(await statusOf(request.id)).toBe('open');
    expect((await http(s).get('/my/notifications').set(asUser(b.token)).expect(200)).body).toEqual([]);
  });
});
