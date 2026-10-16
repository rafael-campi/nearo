import { sql } from 'drizzle-orm';
import { DeadlinesService } from '../src/deadlines/deadlines.service.js';
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

const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 };
const DAY = 24 * 60 * 60_000;

describe('avaliação às cegas e nota por empresa', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  let joao: { token: string; membershipId: string };
  const at = (token: string, companyId = admin.companyId) => asUser(token, companyId);
  const create = async (token = client, companyId = admin.companyId, category = eletrica) =>
    (
      await http(s)
        .post('/company/service-requests')
        .set(at(token, companyId))
        .send({ categoryId: category, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body.id as string;
  /** Pedido levado até o status pedido, pelo caminho normal. */
  const completed = async (provider = joao, requestClient = client, companyId = admin.companyId, category = eletrica) => {
    const id = await create(requestClient, companyId, category);
    await http(s).post(`/company/service-requests/${id}/accept`).set(at(provider.token, companyId)).expect(200);
    await http(s).post(`/company/service-requests/${id}/confirm`).set(at(requestClient, companyId)).expect(200);
    for (const status of ['en_route', 'arrived', 'in_progress', 'completed']) {
      await http(s).post(`/company/service-requests/${id}/status`).set(at(provider.token, companyId)).send({ status }).expect(200);
    }
    return id;
  };
  const review = (token: string, id: string, body: object, companyId = admin.companyId) =>
    http(s).post(`/company/service-requests/${id}/reviews`).set(at(token, companyId)).send(body);
  const reviewsOf = async (token: string, id: string, companyId = admin.companyId) =>
    (await http(s).get(`/company/service-requests/${id}/reviews`).set(at(token, companyId)).expect(200)).body;
  const providerSeenByClient = async (id: string) =>
    (await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body.find((r: { id: string }) => r.id === id).provider;
  const typesOf = async (token: string) =>
    (await http(s).get('/my/notifications').set(asUser(token)).expect(200)).body.map((n: { type: string }) => n.type);
  const deadlines = () => s.app.get(DeadlinesService);

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
    await s.close();
    await ownerPool.end();
  });

  describe('às cegas', () => {
    it('cada lado vê só a própria até os dois avaliarem; então as duas ficam visíveis', async () => {
      const id = await completed();
      const first = await review(client, id, { rating: 5, comment: 'Excelente, muito educado' }).expect(201);
      expect(first.body).toMatchObject({ rating: 5, comment: 'Excelente, muito educado', mine: true, visible: false, reviewerRole: 'client', reviewerName: 'Rita Souza' });

      // O prestador e o admin não veem nada ainda.
      expect((await reviewsOf(joao.token, id)).reviews).toEqual([]);
      expect((await reviewsOf(admin.token, id)).reviews).toEqual([]);
      expect((await reviewsOf(client, id)).reviews).toHaveLength(1);

      await review(joao.token, id, { rating: 4, comment: 'Cliente pontual' }).expect(201);
      for (const token of [client, joao.token, admin.token]) {
        const { reviews } = await reviewsOf(token, id);
        expect(reviews.map((r: { rating: number; visible: boolean }) => [r.rating, r.visible]).sort()).toEqual([[4, true], [5, true]]);
      }
      const forJoao = (await reviewsOf(joao.token, id)).reviews;
      expect(forJoao.map((r: { mine: boolean }) => r.mine).sort()).toEqual([false, true]);
      // Os dois foram avisados de que a avaliação ficou visível.
      expect(await typesOf(client)).toContain('review_received');
      expect(await typesOf(joao.token)).toContain('review_received');
    });

    it('a avaliação escondida não conta na nota nem aparece para o outro lado', async () => {
      const id = await completed();
      await review(client, id, { rating: 1, comment: 'Chegou atrasado' }).expect(201);
      expect((await providerSeenByClient(id)).rating).toEqual({ average: null, count: 0 });
      const providers = (await http(s).get('/company/providers').set(at(admin.token)).expect(200)).body;
      expect(providers[0].rating).toEqual({ average: null, count: 0 });
      expect(await typesOf(joao.token)).not.toContain('review_received');
    });

    it('RLS: o Postgres esconde a avaliação do outro lado até ficar visível', async () => {
      const id = await completed();
      await review(client, id, { rating: 5 }).expect(201);
      const me = async (token: string) => (await http(s).get('/me').set(asUser(token)).expect(200)).body.user.id as string;
      const transactions = s.app.get(TenantTransactions);
      const read = (userId: string, companyId: string | null) =>
        transactions.run({ userId, companyId }, async (tx) => (await tx.execute(sql`select reviewer_id from reviews`)).rows);
      expect(await read(await me(client), admin.companyId)).toHaveLength(1);
      expect(await read(await me(joao.token), admin.companyId)).toEqual([]);
      expect(await read(await me(admin.token), admin.companyId)).toEqual([]);
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      expect(await read(await me(b.token), b.companyId)).toEqual([]);
      expect(await read(await me(client), null)).toEqual([]); // sem empresa no contexto, nada
    });
  });

  describe('quem avalia, quando e quantas vezes', () => {
    it('só depois de concluído; admin e outras pessoas não avaliam', async () => {
      const id = await create();
      await review(client, id, { rating: 5 }).expect(409);
      await http(s).post(`/company/service-requests/${id}/accept`).set(at(joao.token)).expect(200);
      await http(s).post(`/company/service-requests/${id}/confirm`).set(at(client)).expect(200);
      await review(client, id, { rating: 5 }).expect(409);
      await http(s).post(`/company/service-requests/${id}/cancel`).set(at(client)).send({ reason: 'Desisti do serviço' }).expect(204);

      const done = await completed(joao, client);
      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      const maria = await readyProvider(s, admin, 'Maria', 'maria@email.com', { categoryIds: [eletrica], base: paulista });
      await review(admin.token, done, { rating: 5 }).expect(404);
      await review(bruno, done, { rating: 5 }).expect(404);
      await review(maria.token, done, { rating: 5 }).expect(404);
      await review(client, done, { rating: 5 }).expect(201);
    });

    it('pedido cancelado não é avaliado', async () => {
      const id = await create();
      await http(s).post(`/company/service-requests/${id}/cancel`).set(at(client)).send({ reason: 'Desisti do serviço' }).expect(204);
      await review(client, id, { rating: 5 }).expect(409);
    });

    it('uma por lado; nota de 1 a 5 inteira; comentário opcional e limitado', async () => {
      const id = await completed();
      for (const rating of [0, 6, 3.5, '4', null]) await review(client, id, { rating }).expect(400);
      await review(client, id, {}).expect(400);
      await review(client, id, { rating: 5, comment: 'x'.repeat(1001) }).expect(400);
      const ok = await review(client, id, { rating: 3 }).expect(201);
      expect(ok.body.comment).toBe('');
      await review(client, id, { rating: 5 }).expect(409);
      expect((await reviewsOf(client, id)).canReview).toBe(false);
      expect((await reviewsOf(joao.token, id)).canReview).toBe(true);
      expect((await reviewsOf(admin.token, id)).canReview).toBe(false);
    });

    it('até 7 dias depois de concluído', async () => {
      const id = await completed();
      const { deadline } = await reviewsOf(client, id);
      expect(new Date(deadline).getTime() - s.clock.now().getTime()).toBe(7 * DAY);

      s.clock.advance(7 * DAY - 1000);
      await review(client, id, { rating: 5 }).expect(201);
      s.clock.advance(2000);
      const late = await review(joao.token, id, { rating: 4 }).expect(409);
      expect(late.body.message).toBe('O prazo para avaliar acabou');
      expect((await reviewsOf(joao.token, id)).canReview).toBe(false);
    });
  });

  describe('fim do prazo', () => {
    it('revela as avaliações que existirem e avisa quem foi avaliado', async () => {
      const id = await completed();
      await review(client, id, { rating: 2, comment: 'Demorou' }).expect(201);

      s.clock.advance(7 * DAY - 1000);
      await deadlines().runDue();
      expect((await reviewsOf(joao.token, id)).reviews).toEqual([]);

      s.clock.advance(2000);
      await deadlines().runDue();
      const seen = (await reviewsOf(joao.token, id)).reviews;
      expect(seen).toEqual([expect.objectContaining({ rating: 2, comment: 'Demorou', mine: false, visible: true })]);
      expect(await typesOf(joao.token)).toContain('review_received');
      expect(await typesOf(client)).not.toContain('review_received');
      expect((await providerSeenByClient(id)).rating).toEqual({ average: 2, count: 1 });
    });

    it('sem avaliações, o prazo passa sem efeito', async () => {
      await completed();
      s.clock.advance(8 * DAY);
      await deadlines().runDue();
      expect(await typesOf(joao.token)).not.toContain('review_received');
    });
  });

  describe('nota por empresa', () => {
    it('é a média das visíveis, com uma casa e a contagem; aparece na confirmação e para o admin', async () => {
      const first = await completed();
      await review(client, first, { rating: 5 }).expect(201);
      await review(joao.token, first, { rating: 4 }).expect(201);
      const second = await completed();
      await review(client, second, { rating: 4 }).expect(201);
      await review(joao.token, second, { rating: 4 }).expect(201);
      const third = await completed();
      await review(client, third, { rating: 4 }).expect(201); // fica escondida: não entra

      // O cliente vê a nota do prestador ao confirmar o próximo pedido.
      const next = await create();
      await http(s).post(`/company/service-requests/${next}/accept`).set(at(joao.token)).expect(200);
      expect((await providerSeenByClient(next)).rating).toEqual({ average: 4.5, count: 2 });
      expect((await providerSeenByClient(next)).completedCount).toBe(3);

      const providers = (await http(s).get('/company/providers').set(at(admin.token)).expect(200)).body;
      expect(providers[0].rating).toEqual({ average: 4.5, count: 2 });
    });

    it('o prestador vê a nota do cliente e o número de pedidos concluídos antes de aceitar', async () => {
      const first = await completed();
      await review(joao.token, first, { rating: 5 }).expect(201);
      await review(client, first, { rating: 5 }).expect(201);
      const second = await completed();
      await review(joao.token, second, { rating: 4 }).expect(201);
      await review(client, second, { rating: 3 }).expect(201);

      await create();
      const [open] = (await http(s).get('/company/open-requests').set(at(joao.token)).expect(200)).body;
      expect(open).toMatchObject({ clientRating: { average: 4.5, count: 2 }, clientCompletedCount: 2, clientFirstName: 'Rita' });
    });

    it('nunca atravessa empresas', async () => {
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const eletricaB = await categoryOf(s, b, 'Elétrica');
      const joaoB = await readyProvider(s, b, 'João Lima', 'joao@email.com', {
        categoryIds: [eletricaB],
        base: paulista,
        radiusKm: 5,
        password: 'senha-prestador',
      });
      await clientOf(s, b, 'Rita Souza', 'rita2@email.com');
      // A mesma pessoa (Rita) também é cliente da empresa B.
      const code = (await http(s).get('/company/join-code').set(asUser(b.token, b.companyId)).expect(200)).body.joinCode;
      await http(s).post('/join').set(asUser(client)).send({ code }).expect(200);

      const id = await completed();
      await review(client, id, { rating: 5 }).expect(201);
      await review(joao.token, id, { rating: 5 }).expect(201);

      // Na empresa B, nem o João nem a Rita têm nota.
      const requestB = await create(client, b.companyId, eletricaB);
      const [openB] = (await http(s).get('/company/open-requests').set(asUser(joaoB.token, b.companyId)).expect(200)).body;
      expect(openB).toMatchObject({ clientRating: { average: null, count: 0 }, clientCompletedCount: 0 });
      await http(s).post(`/company/service-requests/${requestB}/accept`).set(asUser(joaoB.token, b.companyId)).expect(200);
      const seen = (await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body.find((r: { id: string }) => r.id === requestB);
      expect(seen.provider.rating).toEqual({ average: null, count: 0 });
      expect(seen.provider.completedCount).toBe(0);
      const providersB = (await http(s).get('/company/providers').set(asUser(b.token, b.companyId)).expect(200)).body;
      expect(providersB[0].rating).toEqual({ average: null, count: 0 });
    });
  });

  describe('isolamento entre empresas', () => {
    it('outra empresa não avalia nem lê as avaliações do pedido', async () => {
      const id = await completed();
      await review(client, id, { rating: 5 }).expect(201);
      await review(joao.token, id, { rating: 5 }).expect(201);
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const deB = await clientOf(s, b, 'Bruno B', 'brunob@email.com');
      for (const token of [b.token, deB]) {
        await http(s).get(`/company/service-requests/${id}/reviews`).set(asUser(token, b.companyId)).expect(404);
        await review(token, id, { rating: 1 }, b.companyId).expect(404);
      }
      await http(s).get(`/company/service-requests/${id}/reviews`).set(asUser(client, b.companyId)).expect(404);
    });
  });
});
