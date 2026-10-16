import { randomUUID } from 'node:crypto';
import { ownerPool, resetState } from './support/db.js';
import {
  asUser,
  categoryOf,
  clientOf,
  companyWithAdmin,
  createScenario,
  http,
  readyProvider,
  signupClient,
  type Scenario,
} from './support/scenarios.js';

const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 };
const PASSWORD_CLIENT = 'senha-cliente';
const PASSWORD_PROVIDER = 'senha-prestador';

describe('exclusão de conta', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  let joao: { token: string; membershipId: string };
  const at = (token: string, companyId = admin.companyId) => asUser(token, companyId);
  // `null` envia o corpo sem senha.
  const remove = (token: string, password: string | null = PASSWORD_CLIENT) =>
    http(s).delete('/my/account').set(asUser(token)).send(password === null ? {} : { password });
  const create = async (token = client, companyId = admin.companyId, category = eletrica) =>
    (
      await http(s)
        .post('/company/service-requests')
        .set(at(token, companyId))
        .send({ categoryId: category, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body.id as string;
  const advanceTo = async (id: string, steps: string[], provider = joao, requestClient = client) => {
    await http(s).post(`/company/service-requests/${id}/accept`).set(at(provider.token)).expect(200);
    await http(s).post(`/company/service-requests/${id}/confirm`).set(at(requestClient)).expect(200);
    for (const status of steps) await http(s).post(`/company/service-requests/${id}/status`).set(at(provider.token)).send({ status }).expect(200);
  };
  const login = (email: string, password: string) => http(s).post('/auth/login').send({ email, password });

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

  describe('bloqueios', () => {
    it.each([
      ['aberto', async () => {}],
      [
        'aguardando cliente',
        async (id: string): Promise<void> => {
          await http(s).post(`/company/service-requests/${id}/accept`).set(at(joao.token)).expect(200);
        },
      ],
      ['confirmado', async (id: string): Promise<void> => advanceTo(id, [])],
      ['em execução', async (id: string): Promise<void> => advanceTo(id, ['en_route', 'arrived', 'in_progress'])],
    ] as const)('o cliente com pedido %s não exclui', async (_, setup) => {
      const id = await create();
      await setup(id);
      const res = await remove(client).expect(409);
      expect(res.body.message).toMatch(/pedido aberto ou em andamento/);
      await login('rita@email.com', PASSWORD_CLIENT).expect(200); // a conta segue intacta
    });

    it('o prestador com pedido em andamento não exclui; depois de concluir, exclui', async () => {
      const id = await create();
      await advanceTo(id, ['en_route', 'arrived', 'in_progress']);
      const res = await remove(joao.token, PASSWORD_PROVIDER).expect(409);
      expect(res.body.message).toMatch(/pedido em andamento como prestador/);
      await http(s).post(`/company/service-requests/${id}/status`).set(at(joao.token)).send({ status: 'completed' }).expect(200);
      await remove(joao.token, PASSWORD_PROVIDER).expect(204);
    });

    it('vale para pedidos de qualquer empresa', async () => {
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const eletricaB = await categoryOf(s, b, 'Elétrica');
      const code = (await http(s).get('/company/join-code').set(asUser(b.token, b.companyId)).expect(200)).body.joinCode;
      await http(s).post('/join').set(asUser(client)).send({ code }).expect(200);
      await create(client, b.companyId, eletricaB); // aberto na empresa B; nenhum na A
      await remove(client).expect(409);
    });

    it('cancelado ou concluído não bloqueia', async () => {
      const id = await create();
      await http(s).post(`/company/service-requests/${id}/cancel`).set(at(client)).send({ reason: 'Desisti do serviço' }).expect(204);
      await remove(client).expect(204);
    });

    it('o único administrador de uma empresa não exclui; com outro administrador, exclui', async () => {
      const res = await remove(admin.token, 'senha-segura').expect(409);
      expect(res.body.message).toMatch(/único administrador/);

      await http(s).post('/company/invites').set(asUser(admin.token, admin.companyId)).send({ email: 'bia@silva.com', role: 'admin' }).expect(201);
      await http(s).post(`/invites/${s.mailer.inviteTokenFor('bia@silva.com')}/accept`).send({ name: 'Bia', password: 'senha-da-bia' }).expect(200);
      await remove(admin.token, 'senha-segura').expect(204);
    });

    it('pede a senha e confere', async () => {
      await remove(client, null).expect(400);
      await remove(client, 'senha-errada').expect(401);
      await http(s).delete('/my/account').send({ password: PASSWORD_CLIENT }).expect(401);
      await login('rita@email.com', PASSWORD_CLIENT).expect(200);
    });
  });

  describe('o que a exclusão faz', () => {
    it('apaga os dados pessoais e o login deixa de funcionar', async () => {
      await ownerPool.query(`update users set phone = '11988887777' where email = 'rita@email.com'`);
      const userId = (await http(s).get('/me').set(asUser(client)).expect(200)).body.user.id;
      await http(s).put('/my/device-token').set(asUser(client)).send({ token: 'fcm-token-da-rita-1234', platform: 'android' }).expect(204);

      await remove(client).expect(204);

      const { rows } = await ownerPool.query(`select name, email, phone, deleted_at from users where id = $1`, [userId]);
      expect(rows[0]).toMatchObject({ name: 'Usuário removido', phone: null });
      expect(rows[0].email).toMatch(/^removido-.+@removido\.invalid$/);
      expect(rows[0].deleted_at).not.toBeNull();
      expect((await ownerPool.query(`select active from memberships where user_id = $1`, [userId])).rows.every((r) => r.active === false)).toBe(true);
      for (const table of ['sessions', 'device_tokens', 'notifications']) {
        expect((await ownerPool.query(`select count(*)::int as n from ${table} where user_id = $1`, [userId])).rows[0].n).toBe(0);
      }
      await login('rita@email.com', PASSWORD_CLIENT).expect(401);
      await http(s).get('/me').set(asUser(client)).expect(401);
      // O e-mail fica livre para um cadastro novo.
      await signupClient(s, 'Rita Nova', 'rita@email.com');
      expect((await ownerPool.query(`select count(*)::int as n from users where name = 'Rita Nova'`)).rows[0].n).toBe(1);
    });

    it('prestador: apaga o endereço-base, fica indisponível e deixa de ser apto', async () => {
      await remove(joao.token, PASSWORD_PROVIDER).expect(204);
      const { rows } = await ownerPool.query(`select base_location, available from provider_profiles`);
      expect(rows).toEqual([{ base_location: null, available: false }]);
      const maria = await readyProvider(s, admin, 'Maria', 'maria@email.com', { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
      await create();
      const open = (await http(s).get('/company/open-requests').set(at(maria.token)).expect(200)).body;
      expect(open).toHaveLength(1);
      expect((await ownerPool.query(`select count(*)::int as n from notifications n join users u on u.id = n.user_id where u.name = 'Usuário removido'`)).rows[0].n).toBe(0);
    });

    it('o histórico mostra "Usuário removido" e as notas das outras pessoas não mudam', async () => {
      // Dois pedidos concluídos, avaliados pelos dois lados.
      const rate = async (clientRating: number, providerRating: number) => {
        const id = await create();
        await advanceTo(id, []);
        await http(s).post(`/company/service-requests/${id}/messages`).set(at(client)).send({ clientMessageId: randomUUID(), body: 'obrigada' }).expect(200);
        for (const status of ['en_route', 'arrived', 'in_progress', 'completed']) {
          await http(s).post(`/company/service-requests/${id}/status`).set(at(joao.token)).send({ status }).expect(200);
        }
        await http(s).post(`/company/service-requests/${id}/reviews`).set(at(client)).send({ rating: clientRating, comment: 'Valeu' }).expect(201);
        await http(s).post(`/company/service-requests/${id}/reviews`).set(at(joao.token)).send({ rating: providerRating }).expect(201);
        return id;
      };
      const first = await rate(5, 4);
      await rate(4, 5);
      const before = (await http(s).get('/company/providers').set(at(admin.token)).expect(200)).body[0].rating;
      expect(before).toEqual({ average: 4.5, count: 2 });

      await remove(client).expect(204); // a cliente sai

      const request = (await http(s).get(`/company/service-requests/${first}`).set(at(admin.token)).expect(200)).body;
      expect(request.clientName).toBe('Usuário removido');
      const chat = (await http(s).get(`/company/service-requests/${first}/messages`).set(at(admin.token)).expect(200)).body;
      expect(chat.messages[0]).toMatchObject({ senderName: 'Usuário removido', body: 'obrigada' });
      const reviews = (await http(s).get(`/company/service-requests/${first}/reviews`).set(at(admin.token)).expect(200)).body.reviews;
      expect(reviews.map((r: { reviewerName: string }) => r.reviewerName).sort((a: string, b: string) => a.localeCompare(b))).toEqual(['João Lima', 'Usuário removido']);
      // A nota do prestador continua a mesma.
      const after = (await http(s).get('/company/providers').set(at(admin.token)).expect(200)).body[0].rating;
      expect(after).toEqual(before);
    });

    it('não afeta outras pessoas nem outras empresas', async () => {
      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      await remove(client).expect(204);
      await login('bruno@email.com', PASSWORD_CLIENT).expect(200);
      await login('joao@email.com', PASSWORD_PROVIDER).expect(200);
      expect((await http(s).get('/me').set(asUser(bruno)).expect(200)).body.memberships).toHaveLength(1);
      expect((await http(s).get('/me').set(asUser(b.token)).expect(200)).body.memberships).toHaveLength(1);
      expect((await http(s).get('/company/clients').set(asUser(admin.token, admin.companyId)).expect(200)).body.filter((c: { active: boolean }) => c.active)).toHaveLength(1);
    });
  });
});
