import { sql } from 'drizzle-orm';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { ownerPool, resetState } from './support/db.js';
import {
  asUser,
  companyWithAdmin,
  createScenario,
  http,
  joinCodeOf,
  providerOf,
  signupClient,
  type Scenario,
} from './support/scenarios.js';

describe('convite de prestador', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  const asAdmin = () => asUser(admin.token, admin.companyId);

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    s.mailer.sent.length = 0;
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  const category = async (name: string) =>
    (await http(s).post('/company/categories').set(asAdmin()).send({ name }).expect(201)).body.id as string;
  const providers = async () => (await http(s).get('/company/providers').set(asAdmin()).expect(200)).body;

  it('admin convida; o e-mail diz que é para ser prestador', async () => {
    await http(s).post('/company/invites').set(asAdmin()).send({ email: 'joao@email.com', role: 'provider' }).expect(201);
    const mail = s.mailer.sent.at(-1)!;
    expect(mail.to).toBe('joao@email.com');
    expect(mail.text).toContain('ser prestador em Elétrica Silva');

    const preview = await http(s).get(`/invites/${s.mailer.inviteTokenFor('joao@email.com')}`).expect(200);
    expect(preview.body).toMatchObject({ role: 'provider', hasAccount: false });
  });

  it('não convida cliente por e-mail (cliente entra pelo código)', async () => {
    await http(s).post('/company/invites').set(asAdmin()).send({ email: 'x@email.com', role: 'client' }).expect(400);
  });

  it('aceitar cria o vínculo de prestador, sem categorias', async () => {
    const token = await providerOf(s, admin, 'João', 'joao@email.com');

    const me = await http(s).get('/me').set(asUser(token)).expect(200);
    expect(me.body.memberships).toEqual([
      { companyId: admin.companyId, companyName: 'Elétrica Silva', role: 'provider' },
    ]);
    expect(await providers()).toEqual([
      {
        membershipId: expect.any(String),
        name: 'João',
        email: 'joao@email.com',
        active: true,
        categoryIds: [],
        baseLocation: null,
        serviceRadiusKm: 20,
        available: false,
      },
    ]);
  });

  it('cliente que já tem conta aceita com a mesma conta e fica com os dois papéis', async () => {
    const clientToken = await signupClient(s, 'Rita', 'rita@email.com');
    const code = await joinCodeOf(s, admin);
    await http(s).post('/join').set(asUser(clientToken)).send({ code }).expect(200);

    await http(s).post('/company/invites').set(asAdmin()).send({ email: 'rita@email.com', role: 'provider' }).expect(201);
    const inviteToken = s.mailer.inviteTokenFor('rita@email.com');
    expect((await http(s).get(`/invites/${inviteToken}`).expect(200)).body.hasAccount).toBe(true);
    await http(s).post(`/invites/${inviteToken}/accept`).send({ password: 'senha-cliente' }).expect(200);

    const me = await http(s).get('/me').set(asUser(clientToken)).expect(200);
    expect(me.body.memberships.map((m: { role: string }) => m.role).sort()).toEqual(['client', 'provider']);
  });

  describe('categorias do prestador', () => {
    it('admin define e troca as categorias; o prestador vê as ativas', async () => {
      const eletrica = await category('Elétrica');
      const hidraulica = await category('Hidráulica');
      const token = await providerOf(s, admin, 'João', 'joao@email.com');
      const [joao] = await providers();

      const set = await http(s)
        .put(`/company/providers/${joao.membershipId}/categories`)
        .set(asAdmin())
        .send({ categoryIds: [hidraulica, eletrica, eletrica] })
        .expect(200);
      expect(set.body.categoryIds.sort()).toEqual([eletrica, hidraulica].sort());

      await http(s).patch(`/company/categories/${hidraulica}`).set(asAdmin()).send({ active: false }).expect(200);
      const profile = await http(s).get('/company/provider-profile').set(asUser(token, admin.companyId)).expect(200);
      expect(profile.body.categories).toEqual([{ id: eletrica, name: 'Elétrica' }]);

      await http(s)
        .put(`/company/providers/${joao.membershipId}/categories`)
        .set(asAdmin())
        .send({ categoryIds: [] })
        .expect(200);
      expect((await providers())[0].categoryIds).toEqual([]);
    });

    it('recusa categoria inexistente ou de outra empresa', async () => {
      await providerOf(s, admin, 'João', 'joao@email.com');
      const [joao] = await providers();
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const deB = (await http(s).post('/company/categories').set(asUser(b.token, b.companyId)).send({ name: 'Pintura' }).expect(201))
        .body.id;

      for (const id of [deB, '00000000-0000-0000-0000-000000000000']) {
        await http(s)
          .put(`/company/providers/${joao.membershipId}/categories`)
          .set(asAdmin())
          .send({ categoryIds: [id] })
          .expect(400);
      }
    });

    it('só define categorias de vínculo de prestador', async () => {
      const eletrica = await category('Elétrica');
      const me = await http(s).get('/me').set(asUser(admin.token)).expect(200);
      const { rows } = await ownerPool.query(`select id from memberships where user_id = $1`, [me.body.user.id]);
      await http(s)
        .put(`/company/providers/${rows[0].id}/categories`)
        .set(asAdmin())
        .send({ categoryIds: [eletrica] })
        .expect(404);
    });
  });

  it('admin desativa e reativa; desativado perde o acesso de prestador', async () => {
    const token = await providerOf(s, admin, 'João', 'joao@email.com');
    const [joao] = await providers();

    const off = await http(s).patch(`/company/providers/${joao.membershipId}`).set(asAdmin()).send({ active: false }).expect(200);
    expect(off.body.active).toBe(false);
    await http(s).get('/company/provider-profile').set(asUser(token, admin.companyId)).expect(404);
    expect((await http(s).get('/me').set(asUser(token)).expect(200)).body.memberships).toEqual([]);

    await http(s).patch(`/company/providers/${joao.membershipId}`).set(asAdmin()).send({ active: true }).expect(200);
    await http(s).get('/company/provider-profile').set(asUser(token, admin.companyId)).expect(200);
  });

  it('só admin gerencia prestadores; prestador não vê a lista', async () => {
    const token = await providerOf(s, admin, 'João', 'joao@email.com');
    await http(s).get('/company/providers').set(asUser(token, admin.companyId)).expect(404);
    await http(s)
      .post('/company/invites')
      .set(asUser(token, admin.companyId))
      .send({ email: 'x@email.com', role: 'provider' })
      .expect(404);
  });

  describe('isolamento entre empresas', () => {
    it('admin de outra empresa não lista nem altera prestadores desta', async () => {
      await providerOf(s, admin, 'João', 'joao@email.com');
      const [joao] = await providers();
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const asB = asUser(b.token, b.companyId);

      expect((await http(s).get('/company/providers').set(asB).expect(200)).body).toEqual([]);
      await http(s).patch(`/company/providers/${joao.membershipId}`).set(asB).send({ active: false }).expect(404);
      await http(s)
        .put(`/company/providers/${joao.membershipId}/categories`)
        .set(asB)
        .send({ categoryIds: [] })
        .expect(404);
      expect((await providers())[0]).toMatchObject({ active: true });
    });

    it('RLS: categorias de prestador de outra empresa não aparecem nem são gravadas', async () => {
      const eletrica = await category('Elétrica');
      await providerOf(s, admin, 'João', 'joao@email.com');
      const [joao] = await providers();
      await http(s)
        .put(`/company/providers/${joao.membershipId}/categories`)
        .set(asAdmin())
        .send({ categoryIds: [eletrica] })
        .expect(200);

      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const meB = await http(s).get('/me').set(asUser(b.token)).expect(200);
      const ctx = { userId: meB.body.user.id as string, companyId: b.companyId };
      const transactions = s.app.get(TenantTransactions);

      const seen = await transactions.run(ctx, async (tx) => (await tx.execute(sql`select * from provider_categories`)).rows);
      expect(seen).toEqual([]);
      await expect(
        transactions.run(ctx, (tx) =>
          tx.execute(
            sql`insert into provider_categories (company_id, membership_id, category_id)
                values (${admin.companyId}, ${joao.membershipId}, ${eletrica})`,
          ),
        ),
      ).rejects.toThrow();
    });
  });
});
