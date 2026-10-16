import { createCompany } from '../src/scripts/create-company.js';
import { ownerPool, resetState } from './support/db.js';
import { asUser, companyWithAdmin, createScenario, http, type Scenario } from './support/scenarios.js';

const DAY = 24 * 60 * 60 * 1000;

describe('empresa por script e primeiro admin', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    s.mailer.sent.length = 0;
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  describe('script company:create', () => {
    it('cria a empresa e envia o convite de admin por e-mail', async () => {
      const { company, invite } = await createCompany(s.platform, [
        '--name',
        'Elétrica Silva',
        '--admin-email',
        ' Ana@Silva.com ',
      ]);

      expect(company.name).toBe('Elétrica Silva');
      expect(invite).toMatchObject({ email: 'ana@silva.com', role: 'admin' });
      expect(s.mailer.sent).toHaveLength(1);
      expect(s.mailer.sent[0]).toMatchObject({ to: 'ana@silva.com' });
      expect(s.mailer.sent[0].text).toContain('http://localhost:3001/invites/');
    });

    it('recusa argumentos inválidos', async () => {
      await expect(createCompany(s.platform, ['--name', 'X', '--admin-email', 'não-é-email'])).rejects.toThrow();
      await expect(createCompany(s.platform, ['--admin-email', 'a@b.com'])).rejects.toThrow();
    });
  });

  describe('aceite do convite', () => {
    it('mostra a empresa e indica que a pessoa ainda não tem conta', async () => {
      await createCompany(s.platform, ['--name', 'Elétrica Silva', '--admin-email', 'ana@silva.com']);
      const res = await http(s).get(`/invites/${s.mailer.inviteTokenFor('ana@silva.com')}`).expect(200);
      expect(res.body).toEqual({
        companyName: 'Elétrica Silva',
        email: 'ana@silva.com',
        role: 'admin',
        hasAccount: false,
      });
    });

    it('cria a conta, entra e vê o painel da empresa', async () => {
      const { company } = await createCompany(s.platform, ['--name', 'Elétrica Silva', '--admin-email', 'ana@silva.com']);
      const accepted = await http(s)
        .post(`/invites/${s.mailer.inviteTokenFor('ana@silva.com')}/accept`)
        .send({ name: 'Ana', password: 'senha-segura' })
        .expect(200);
      expect(accepted.body.companyId).toBe(company.id);

      const login = await http(s)
        .post('/auth/login')
        .send({ email: 'ANA@silva.com', password: 'senha-segura' })
        .expect(200);

      const me = await http(s).get('/me').set(asUser(login.body.token)).expect(200);
      expect(me.body).toMatchObject({
        user: { name: 'Ana', email: 'ana@silva.com' },
        memberships: [{ companyId: company.id, companyName: 'Elétrica Silva', role: 'admin' }],
      });

      const panel = await http(s).get('/company').set(asUser(login.body.token, company.id)).expect(200);
      expect(panel.body).toEqual({ id: company.id, name: 'Elétrica Silva', assignmentMode: 'broadcast' });
    });

    it('exige nome de quem ainda não tem conta e senha de pelo menos 8 caracteres', async () => {
      await createCompany(s.platform, ['--name', 'Elétrica Silva', '--admin-email', 'ana@silva.com']);
      const token = s.mailer.inviteTokenFor('ana@silva.com');
      await http(s).post(`/invites/${token}/accept`).send({ password: 'senha-segura' }).expect(400);
      await http(s).post(`/invites/${token}/accept`).send({ name: 'Ana', password: 'curta' }).expect(400);
    });

    it('só pode ser aceito uma vez', async () => {
      await createCompany(s.platform, ['--name', 'Elétrica Silva', '--admin-email', 'ana@silva.com']);
      const token = s.mailer.inviteTokenFor('ana@silva.com');
      await http(s).post(`/invites/${token}/accept`).send({ name: 'Ana', password: 'senha-segura' }).expect(200);
      await http(s).get(`/invites/${token}`).expect(404);
      await http(s).post(`/invites/${token}/accept`).send({ password: 'senha-segura' }).expect(404);
    });

    it('de dois aceites simultâneos, só um vale', async () => {
      // Conta já existe (admin de outra empresa), então os três pedidos só disputam o convite.
      await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      await createCompany(s.platform, ['--name', 'Hidráulica Souza', '--admin-email', 'ana@silva.com']);
      const token = s.mailer.inviteTokenFor('ana@silva.com');
      const results = await Promise.all(
        [1, 2, 3].map(() => http(s).post(`/invites/${token}/accept`).send({ password: 'senha-segura' })),
      );
      expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 404, 404]);
    });

    it('expira em 7 dias', async () => {
      await createCompany(s.platform, ['--name', 'Elétrica Silva', '--admin-email', 'ana@silva.com']);
      const token = s.mailer.inviteTokenFor('ana@silva.com');
      s.clock.advance(7 * DAY + 1);
      await http(s).get(`/invites/${token}`).expect(404);
      await http(s).post(`/invites/${token}/accept`).send({ name: 'Ana', password: 'senha-segura' }).expect(404);
    });

    it('token desconhecido responde 404', async () => {
      await http(s).get('/invites/nao-existe').expect(404);
    });

    it('quem já tem conta confirma com a senha atual e mantém a mesma conta', async () => {
      await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      const { company: other } = await createCompany(s.platform, [
        '--name',
        'Hidráulica Souza',
        '--admin-email',
        'ana@silva.com',
      ]);
      const token = s.mailer.inviteTokenFor('ana@silva.com');

      const preview = await http(s).get(`/invites/${token}`).expect(200);
      expect(preview.body.hasAccount).toBe(true);
      await http(s).post(`/invites/${token}/accept`).send({ password: 'senha-errada' }).expect(401);
      const accepted = await http(s).post(`/invites/${token}/accept`).send({ password: 'senha-segura' }).expect(200);

      const me = await http(s).get('/me').set(asUser(accepted.body.token)).expect(200);
      expect(me.body.memberships.map((m: { companyId: string }) => m.companyId)).toContain(other.id);
      expect(me.body.memberships).toHaveLength(2);
    });
  });

  describe('login e sessão', () => {
    it('recusa senha errada e e-mail inexistente com a mesma resposta', async () => {
      await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      const wrong = await http(s).post('/auth/login').send({ email: 'ana@silva.com', password: 'senha-errada' });
      const unknown = await http(s).post('/auth/login').send({ email: 'ninguem@x.com', password: 'senha-errada' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('exige sessão nas rotas autenticadas', async () => {
      await http(s).get('/me').expect(401);
      await http(s).get('/me').set(asUser('token-inventado')).expect(401);
    });

    it('logout invalida a sessão', async () => {
      const { token } = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      await http(s).post('/auth/logout').set(asUser(token)).expect(204);
      await http(s).get('/me').set(asUser(token)).expect(401);
    });

    it('sessão expira em 30 dias', async () => {
      const { token } = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      s.clock.advance(30 * DAY + 1);
      await http(s).get('/me').set(asUser(token)).expect(401);
    });
  });

  describe('admin convida outro admin', () => {
    it('o convidado aceita e passa a administrar a empresa', async () => {
      const { companyId, token } = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');

      const invite = await http(s)
        .post('/company/invites')
        .set(asUser(token, companyId))
        .send({ email: 'bia@silva.com', role: 'admin' })
        .expect(201);
      expect(invite.body).toMatchObject({ email: 'bia@silva.com', role: 'admin' });

      const accepted = await http(s)
        .post(`/invites/${s.mailer.inviteTokenFor('bia@silva.com')}/accept`)
        .send({ name: 'Bia', password: 'outra-senha' })
        .expect(200);
      await http(s).get('/company').set(asUser(accepted.body.token, companyId)).expect(200);
    });

    it('só admin convida', async () => {
      const { companyId, token } = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      await ownerPool.query(`update memberships set role = 'client' where company_id = $1`, [companyId]);
      await http(s)
        .post('/company/invites')
        .set(asUser(token, companyId))
        .send({ email: 'bia@silva.com', role: 'admin' })
        .expect(404);
    });

    it('valida o e-mail', async () => {
      const { companyId, token } = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      await http(s)
        .post('/company/invites')
        .set(asUser(token, companyId))
        .send({ email: 'sem-arroba', role: 'admin' })
        .expect(400);
    });
  });

  describe('empresa desativada', () => {
    it('derruba o acesso de todos os vínculos', async () => {
      const { companyId, token } = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      await http(s)
        .post('/company/invites')
        .set(asUser(token, companyId))
        .send({ email: 'bia@silva.com', role: 'admin' })
        .expect(201);

      await ownerPool.query(`update companies set active = false where id = $1`, [companyId]);

      await http(s).get('/company').set(asUser(token, companyId)).expect(404);
      const me = await http(s).get('/me').set(asUser(token)).expect(200);
      expect(me.body.memberships).toEqual([]);
      await http(s).get(`/invites/${s.mailer.inviteTokenFor('bia@silva.com')}`).expect(404);
    });
  });

  describe('isolamento entre empresas', () => {
    it('admin de uma empresa recebe 404 nos recursos de outra', async () => {
      const a = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');

      await http(s).get('/company').set(asUser(a.token, b.companyId)).expect(404);
      await http(s)
        .post('/company/invites')
        .set(asUser(a.token, b.companyId))
        .send({ email: 'intruso@x.com', role: 'admin' })
        .expect(404);
      await http(s).get('/company').set(asUser(a.token, 'nao-e-uuid')).expect(404);
      await http(s).get('/company').set(asUser(a.token)).expect(404);
    });
  });
});
