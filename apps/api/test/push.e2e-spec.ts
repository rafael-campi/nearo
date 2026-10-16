import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { PushService } from '../src/push/push.service.js';
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
const paulista = { latitude: -23.5614, longitude: -46.6559 };
const near = { latitude: -23.5535, longitude: -46.6339 };
const tokenOf = (label: string) => `fcm-token-${label}-${'x'.repeat(20)}`;

describe('push via FCM', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  let joao: { token: string; membershipId: string };
  const at = (token: string, companyId = admin.companyId) => asUser(token, companyId);
  const register = (session: string, token: string, platform = 'android') =>
    http(s).put('/my/device-token').set(asUser(session)).send({ token, platform });
  const drain = () => s.app.get(PushService).drain();
  const tokens = async () => (await ownerPool.query(`select token, platform, user_id from device_tokens order by token`)).rows;
  const userIdOf = async (session: string) => (await http(s).get('/me').set(asUser(session)).expect(200)).body.user.id as string;
  const create = async () =>
    (
      await http(s)
        .post('/company/service-requests')
        .set(at(client))
        .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    s.mailer.sent.length = 0;
    s.push.sent.length = 0;
    s.push.invalid.clear();
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    eletrica = await categoryOf(s, admin, 'Elétrica');
    client = await clientOf(s, admin, 'Rita Souza', 'rita@email.com');
    joao = await readyProvider(s, admin, 'João Lima', 'joao@email.com', { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  describe('token do aparelho', () => {
    it('registra, atualiza sem duplicar e remove ao sair', async () => {
      await register(client, tokenOf('rita')).expect(204);
      await register(client, tokenOf('rita'), 'ios').expect(204);
      expect(await tokens()).toEqual([{ token: tokenOf('rita'), platform: 'ios', user_id: await userIdOf(client) }]);

      await http(s).delete('/my/device-token').set(asUser(client)).send({ token: tokenOf('rita') }).expect(204);
      expect(await tokens()).toEqual([]);
    });

    it('valida o corpo e exige login', async () => {
      await register(client, 'curto').expect(400);
      await register(client, tokenOf('rita'), 'windows').expect(400);
      await http(s).put('/my/device-token').send({ token: tokenOf('rita'), platform: 'android' }).expect(401);
      await http(s).delete('/my/device-token').send({ token: tokenOf('rita') }).expect(401);
    });

    it('o aparelho que troca de conta leva o token junto', async () => {
      await register(client, tokenOf('aparelho')).expect(204);
      await register(joao.token, tokenOf('aparelho')).expect(204);
      expect(await tokens()).toEqual([{ token: tokenOf('aparelho'), platform: 'android', user_id: await userIdOf(joao.token) }]);
    });

    it('ninguém remove nem lê o token de outra pessoa (RLS)', async () => {
      await register(client, tokenOf('rita')).expect(204);
      await http(s).delete('/my/device-token').set(asUser(joao.token)).send({ token: tokenOf('rita') }).expect(204);
      expect(await tokens()).toHaveLength(1);

      const transactions = s.app.get(TenantTransactions);
      const asJoao = { userId: await userIdOf(joao.token), companyId: null };
      expect(await transactions.run(asJoao, async (tx) => (await tx.execute(sql`select * from device_tokens`)).rows)).toEqual([]);
      const asRita = { userId: await userIdOf(client), companyId: null };
      expect(await transactions.run(asRita, async (tx) => (await tx.execute(sql`select * from device_tokens`)).rows)).toHaveLength(1);
    });
  });

  describe('worker', () => {
    it('envia a atualização aos aparelhos de quem a recebe, com os dados para abrir a tela', async () => {
      await register(joao.token, tokenOf('joao-1')).expect(204);
      await register(joao.token, tokenOf('joao-2')).expect(204);
      const id = await create();

      expect(s.push.sent).toEqual([]); // ainda na fila: o worker é quem envia
      await drain();
      expect(s.push.sent.map((m) => m.token).sort((a, b) => a.localeCompare(b))).toEqual([tokenOf('joao-1'), tokenOf('joao-2')]);
      expect(s.push.sent[0]).toEqual({
        token: expect.any(String),
        title: 'Pedido novo: Elétrica',
        body: 'Sé · a 2,6 km de você',
        data: { type: 'new_request', serviceRequestId: id, companyId: admin.companyId },
      });
    });

    it('quem não tem aparelho registrado não recebe, e a atualização continua gravada', async () => {
      await create();
      await drain();
      expect(s.push.sent).toEqual([]);
      expect((await http(s).get('/my/notifications').set(asUser(joao.token)).expect(200)).body).toHaveLength(1);
    });

    it('toda atualização gera push: pedido novo, aceite, confirmação, status, raio de aviso, cancelamento…', async () => {
      await register(client, tokenOf('rita')).expect(204);
      await register(joao.token, tokenOf('joao')).expect(204);
      await register(admin.token, tokenOf('ana')).expect(204);
      const id = await create(); // new_request (João)
      await http(s).post(`/company/service-requests/${id}/accept`).set(at(joao.token)).expect(200); // request_accepted (Rita)
      await http(s).post(`/company/service-requests/${id}/confirm`).set(at(client)).expect(200); // request_confirmed (João)
      await http(s).post(`/company/service-requests/${id}/status`).set(at(joao.token)).send({ status: 'en_route' }).expect(200); // request_status
      await http(s).post(`/company/service-requests/${id}/location`).set(at(joao.token)).send(near).expect(204); // provider_nearby
      await http(s).post(`/company/service-requests/${id}/withdraw`).set(at(joao.token)).send({ reason: 'Imprevisto na estrada' }).expect(204); // request_withdrawn (Rita)
      await http(s).post(`/company/service-requests/${id}/admin-cancel`).set(asUser(admin.token, admin.companyId)).send({ reason: 'Pedido duplicado' }).expect(204); // request_cancelled (Rita)
      await drain();

      const { rows } = await ownerPool.query(`select type, user_id from notifications`);
      expect(s.push.sent).toHaveLength(rows.length); // cada atualização, um push (todos têm aparelho)
      expect(new Set(s.push.sent.map((m) => m.data.type))).toEqual(
        new Set(['new_request', 'request_accepted', 'request_confirmed', 'request_status', 'provider_nearby', 'request_withdrawn', 'request_cancelled']),
      );
    });

    it('lembretes e avaliações também viram push', async () => {
      await register(client, tokenOf('rita')).expect(204);
      await register(joao.token, tokenOf('joao')).expect(204);
      const id = await create();
      await http(s).post(`/company/service-requests/${id}/accept`).set(at(joao.token)).expect(200);
      await http(s).post(`/company/service-requests/${id}/confirm`).set(at(client)).expect(200);
      for (const status of ['en_route', 'arrived', 'in_progress', 'completed']) {
        await http(s).post(`/company/service-requests/${id}/status`).set(at(joao.token)).send({ status }).expect(200);
      }
      await http(s).post(`/company/service-requests/${id}/reviews`).set(at(client)).send({ rating: 5 }).expect(201);
      await http(s).post(`/company/service-requests/${id}/reviews`).set(at(joao.token)).send({ rating: 5 }).expect(201);
      await drain();
      expect(s.push.sent.map((m) => m.data.type)).toContain('review_received');
      const { rows } = await ownerPool.query(`select count(*)::int as n from notifications`);
      expect(s.push.sent).toHaveLength(rows[0].n);
    });

    it('mensagem do chat vira push para o outro lado, com o nome de quem mandou', async () => {
      await register(client, tokenOf('rita')).expect(204);
      await register(joao.token, tokenOf('joao')).expect(204);
      const id = await create();
      await http(s).post(`/company/service-requests/${id}/accept`).set(at(joao.token)).expect(200);
      await http(s).post(`/company/service-requests/${id}/confirm`).set(at(client)).expect(200);
      await drain();
      s.push.sent.length = 0;

      await http(s).post(`/company/service-requests/${id}/messages`).set(at(client)).send({ clientMessageId: randomUUID(), body: 'Chegou?' }).expect(200);
      await drain();
      expect(s.push.sent).toEqual([
        { token: tokenOf('joao'), title: 'Rita', body: 'Chegou?', data: { type: 'new_message', serviceRequestId: id, companyId: admin.companyId } },
      ]);

      s.push.sent.length = 0;
      const key = (await http(s).post('/company/uploads').set(at(joao.token)).send({ purpose: 'chat_photo', contentLength: 1000 }).expect(201)).body.key;
      await http(s).post(`/company/service-requests/${id}/messages`).set(at(joao.token)).send({ clientMessageId: randomUUID(), photoKey: key }).expect(200);
      await drain();
      expect(s.push.sent).toEqual([expect.objectContaining({ token: tokenOf('rita'), title: 'João', body: '📷 Foto' })]);

      // Reenvio da mesma mensagem não repete o push.
      s.push.sent.length = 0;
      const clientMessageId = randomUUID();
      await http(s).post(`/company/service-requests/${id}/messages`).set(at(client)).send({ clientMessageId, body: 'oi' }).expect(200);
      await http(s).post(`/company/service-requests/${id}/messages`).set(at(client)).send({ clientMessageId, body: 'oi' }).expect(200);
      await drain();
      expect(s.push.sent).toHaveLength(1);
    });

    it('token recusado pelo FCM é removido; os válidos continuam', async () => {
      await register(joao.token, tokenOf('velho')).expect(204);
      await register(joao.token, tokenOf('novo')).expect(204);
      s.push.invalid.add(tokenOf('velho'));
      await create();
      await drain();
      expect(s.push.sent.map((m) => m.token)).toEqual([tokenOf('novo')]);
      expect((await tokens()).map((t) => t.token)).toEqual([tokenOf('novo')]);
    });

    it('depois de sair, o aparelho deixa de receber', async () => {
      await register(joao.token, tokenOf('joao')).expect(204);
      await http(s).delete('/my/device-token').set(asUser(joao.token)).send({ token: tokenOf('joao') }).expect(204);
      await create();
      await drain();
      expect(s.push.sent).toEqual([]);
    });
  });
});
