import { sql } from 'drizzle-orm';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { ownerPool, resetState } from './support/db.js';
import {
  asUser,
  companyWithAdmin,
  createScenario,
  http,
  joinCodeOf,
  signupClient,
  type Scenario,
} from './support/scenarios.js';

describe('cliente: cadastro e entrada pelo código de acesso', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  const asAdmin = () => asUser(admin.token, admin.companyId);

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  describe('cadastro', () => {
    it('cria a conta e já entra logado, sem nenhuma empresa', async () => {
      const token = await signupClient(s, 'Rita', ' Rita@Email.com ');
      const me = await http(s).get('/me').set(asUser(token)).expect(200);
      expect(me.body).toMatchObject({ user: { name: 'Rita', email: 'rita@email.com' }, memberships: [] });

      await http(s).post('/auth/login').send({ email: 'rita@email.com', password: 'senha-cliente' }).expect(200);
    });

    it('recusa e-mail já cadastrado', async () => {
      await signupClient(s, 'Rita', 'rita@email.com');
      const res = await http(s)
        .post('/auth/signup')
        .send({ name: 'Outra', email: 'RITA@email.com', password: 'qualquer-senha' })
        .expect(409);
      expect(res.body.message).toBe('Já existe uma conta com esse e-mail');
    });

    it('valida nome, e-mail e senha', async () => {
      await http(s).post('/auth/signup').send({ name: '', email: 'a@b.com', password: 'senha-cliente' }).expect(400);
      await http(s).post('/auth/signup').send({ name: 'A', email: 'sem-arroba', password: 'senha-cliente' }).expect(400);
      await http(s).post('/auth/signup').send({ name: 'A', email: 'a@b.com', password: 'curta' }).expect(400);
    });
  });

  describe('código de acesso', () => {
    it('admin vê o código da empresa: 8 caracteres fáceis de ditar', async () => {
      expect(await joinCodeOf(s, admin)).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    });

    it('cliente entra pelo código e vira cliente da empresa', async () => {
      const code = await joinCodeOf(s, admin);
      const token = await signupClient(s, 'Rita', 'rita@email.com');

      const joined = await http(s).post('/join').set(asUser(token)).send({ code: ` ${code.toLowerCase()} ` }).expect(200);
      expect(joined.body).toEqual({ companyId: admin.companyId, companyName: 'Elétrica Silva' });

      const me = await http(s).get('/me').set(asUser(token)).expect(200);
      expect(me.body.memberships).toEqual([
        { companyId: admin.companyId, companyName: 'Elétrica Silva', role: 'client' },
      ]);
      const company = await http(s).get('/company').set(asUser(token, admin.companyId)).expect(200);
      expect(company.body.name).toBe('Elétrica Silva');
    });

    it('entrar de novo não duplica o vínculo', async () => {
      const code = await joinCodeOf(s, admin);
      const token = await signupClient(s, 'Rita', 'rita@email.com');
      await http(s).post('/join').set(asUser(token)).send({ code }).expect(200);
      await http(s).post('/join').set(asUser(token)).send({ code }).expect(200);

      const clients = await http(s).get('/company/clients').set(asAdmin()).expect(200);
      expect(clients.body).toHaveLength(1);
    });

    it('código desconhecido ou de empresa desativada responde 404', async () => {
      const token = await signupClient(s, 'Rita', 'rita@email.com');
      await http(s).post('/join').set(asUser(token)).send({ code: 'ZZZZZZZZ' }).expect(404);
      await http(s).post('/join').set(asUser(token)).send({ code: '!!' }).expect(400);

      const code = await joinCodeOf(s, admin);
      await ownerPool.query(`update companies set active = false where id = $1`, [admin.companyId]);
      await http(s).post('/join').set(asUser(token)).send({ code }).expect(404);
    });

    it('exige estar logado', async () => {
      const code = await joinCodeOf(s, admin);
      await http(s).post('/join').send({ code: code }).expect(401);
    });

    it('cliente não vê o código nem a lista de clientes', async () => {
      const code = await joinCodeOf(s, admin);
      const token = await signupClient(s, 'Rita', 'rita@email.com');
      await http(s).post('/join').set(asUser(token)).send({ code }).expect(200);

      await http(s).get('/company/join-code').set(asUser(token, admin.companyId)).expect(404);
      await http(s).get('/company/clients').set(asUser(token, admin.companyId)).expect(404);
    });
  });

  describe('admin gerencia clientes', () => {
    const joinAs = async (name: string, email: string) => {
      const token = await signupClient(s, name, email);
      const code = await joinCodeOf(s, admin);
      await http(s).post('/join').set(asUser(token)).send({ code: code }).expect(200);
      return token;
    };

    it('lista os clientes em ordem alfabética', async () => {
      await joinAs('Rita', 'rita@email.com');
      await joinAs('bruno', 'bruno@email.com');

      const res = await http(s).get('/company/clients').set(asAdmin()).expect(200);
      expect(res.body.map((c: { name: string }) => c.name)).toEqual(['bruno', 'Rita']);
      expect(res.body[1]).toMatchObject({ email: 'rita@email.com', active: true });
    });

    it('desativar tira o acesso do cliente à empresa; entrar pelo código não reativa', async () => {
      const token = await joinAs('Rita', 'rita@email.com');
      const [client] = (await http(s).get('/company/clients').set(asAdmin()).expect(200)).body;

      const off = await http(s)
        .patch(`/company/clients/${client.membershipId}`)
        .set(asAdmin())
        .send({ active: false })
        .expect(200);
      expect(off.body.active).toBe(false);

      await http(s).get('/company').set(asUser(token, admin.companyId)).expect(404);
      expect((await http(s).get('/me').set(asUser(token)).expect(200)).body.memberships).toEqual([]);
      const code = await joinCodeOf(s, admin);
      const rejoin = await http(s).post('/join').set(asUser(token)).send({ code: code }).expect(403);
      expect(rejoin.body.message).toBe('Seu acesso a esta empresa foi desativado');

      await http(s).patch(`/company/clients/${client.membershipId}`).set(asAdmin()).send({ active: true }).expect(200);
      await http(s).get('/company').set(asUser(token, admin.companyId)).expect(200);
    });

    it('só altera vínculos de cliente', async () => {
      const me = await http(s).get('/me').set(asUser(admin.token)).expect(200);
      const { rows } = await ownerPool.query(`select id from memberships where user_id = $1`, [me.body.user.id]);
      await http(s).patch(`/company/clients/${rows[0].id}`).set(asAdmin()).send({ active: false }).expect(404);
    });
  });

  describe('isolamento entre empresas', () => {
    it('admin de outra empresa não lista nem altera os clientes desta', async () => {
      const token = await signupClient(s, 'Rita', 'rita@email.com');
      const code = await joinCodeOf(s, admin);
      await http(s).post('/join').set(asUser(token)).send({ code: code }).expect(200);
      const [client] = (await http(s).get('/company/clients').set(asAdmin()).expect(200)).body;

      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const asB = asUser(b.token, b.companyId);
      expect((await http(s).get('/company/clients').set(asB).expect(200)).body).toEqual([]);
      await http(s).patch(`/company/clients/${client.membershipId}`).set(asB).send({ active: false }).expect(404);
      expect(await joinCodeOf(s, b)).not.toBe(await joinCodeOf(s, admin));
    });

    it('cliente de uma empresa recebe 404 em outra', async () => {
      const token = await signupClient(s, 'Rita', 'rita@email.com');
      const code = await joinCodeOf(s, admin);
      await http(s).post('/join').set(asUser(token)).send({ code: code }).expect(200);
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      await http(s).get('/company').set(asUser(token, b.companyId)).expect(404);
    });

    it('RLS: o código de outra empresa não aparece agindo nesta', async () => {
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const me = await http(s).get('/me').set(asUser(admin.token)).expect(200);
      const codes = await s.app
        .get(TenantTransactions)
        .run({ userId: me.body.user.id, companyId: admin.companyId }, async (tx) =>
          (await tx.execute<{ join_code: string }>(sql`select join_code from companies`)).rows.map((r) => r.join_code),
        );
      expect(codes).toEqual([await joinCodeOf(s, admin)]);
      expect(codes).not.toContain(await joinCodeOf(s, b));
    });
  });
});
