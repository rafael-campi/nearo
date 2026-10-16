import { ownerPool, resetState } from './support/db.js';
import { asUser, clientOf, companyWithAdmin, createScenario, http, signupClient, type Scenario } from './support/scenarios.js';

const MINUTE = 60_000;

describe('recuperação de senha', () => {
  let s: Scenario;
  const forgot = (email: string) => http(s).post('/auth/forgot-password').send({ email });
  const reset = (token: string, password: string) => http(s).post('/auth/reset-password').send({ token, password });
  const login = (email: string, password: string) => http(s).post('/auth/login').send({ email, password });
  const emailsTo = (email: string) => s.mailer.sent.filter((m) => m.to === email && m.subject.includes('Redefinir'));

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    s.mailer.sent.length = 0;
    await signupClient(s, 'Rita Souza', 'rita@email.com');
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  describe('pedido', () => {
    it('não revela se o e-mail existe: mesma resposta, e só a conta existente recebe e-mail', async () => {
      const known = await forgot('rita@email.com');
      const unknown = await forgot('ninguem@email.com');
      expect(known.status).toBe(204);
      expect(unknown.status).toBe(204);
      expect(known.body).toEqual(unknown.body);
      expect(known.text).toBe(unknown.text);
      expect(emailsTo('rita@email.com')).toHaveLength(1);
      expect(emailsTo('ninguem@email.com')).toHaveLength(0);
    });

    it('o e-mail traz o link do painel e o do aplicativo, com um token que não fica gravado', async () => {
      await forgot('rita@email.com').expect(204);
      const token = s.mailer.resetTokenFor('rita@email.com');
      const text = emailsTo('rita@email.com')[0].text;
      expect(text).toContain(`http://localhost:3001/reset-password/${token}`);
      expect(text).toContain(`despacho://reset-password/${token}`);
      expect(text).toContain('1 hora');
      const { rows } = await ownerPool.query(`select token_hash from password_resets`);
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).not.toContain(token);
    });

    it('e-mail com formato inválido é recusado; maiúsculas e espaços são normalizados', async () => {
      await forgot('isso-nao-e-email').expect(400);
      await forgot('  RITA@Email.com ').expect(204);
      expect(emailsTo('rita@email.com')).toHaveLength(1);
    });

    it('no máximo um e-mail por minuto por conta; depois disso, o link novo substitui o anterior', async () => {
      await forgot('rita@email.com').expect(204);
      const first = s.mailer.resetTokenFor('rita@email.com');
      await forgot('rita@email.com').expect(204);
      expect(emailsTo('rita@email.com')).toHaveLength(1);

      s.clock.advance(MINUTE + 1);
      await forgot('rita@email.com').expect(204);
      expect(emailsTo('rita@email.com')).toHaveLength(2);
      const second = s.mailer.resetTokenFor('rita@email.com');
      expect(second).not.toBe(first);
      await reset(first, 'senha-nova-1').expect(400);
      await reset(second, 'senha-nova-2').expect(204);
    });

    it('conta excluída não recebe', async () => {
      const session = (await login('rita@email.com', 'senha-cliente').expect(200)).body.token;
      await http(s).delete('/my/account').set(asUser(session)).send({ password: 'senha-cliente' }).expect(204);
      await forgot('rita@email.com').expect(204);
      expect(s.mailer.sent.filter((m) => m.subject.includes('Redefinir'))).toHaveLength(0);
    });
  });

  describe('redefinição', () => {
    it('define a senha nova: a antiga deixa de valer e o login funciona', async () => {
      await forgot('rita@email.com').expect(204);
      const token = s.mailer.resetTokenFor('rita@email.com');
      await reset(token, 'uma-senha-nova').expect(204);
      await login('rita@email.com', 'senha-cliente').expect(401);
      await login('rita@email.com', 'uma-senha-nova').expect(200);
    });

    it('encerra as sessões abertas da conta', async () => {
      const open = (await login('rita@email.com', 'senha-cliente').expect(200)).body.token;
      await http(s).get('/me').set(asUser(open)).expect(200);
      await forgot('rita@email.com').expect(204);
      await reset(s.mailer.resetTokenFor('rita@email.com'), 'uma-senha-nova').expect(204);
      await http(s).get('/me').set(asUser(open)).expect(401);
    });

    it('o link só vale uma vez', async () => {
      await forgot('rita@email.com').expect(204);
      const token = s.mailer.resetTokenFor('rita@email.com');
      await reset(token, 'uma-senha-nova').expect(204);
      const again = await reset(token, 'outra-senha-nova').expect(400);
      expect(again.body.message).toBe('Link inválido ou expirado. Peça um novo.');
      await login('rita@email.com', 'uma-senha-nova').expect(200);
    });

    it('usos simultâneos do mesmo link: só um vence', async () => {
      await forgot('rita@email.com').expect(204);
      const token = s.mailer.resetTokenFor('rita@email.com');
      const results = await Promise.all([reset(token, 'senha-nova-aaa'), reset(token, 'senha-nova-bbb')]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([204, 400]);
    });

    it('o link expira em 1 hora', async () => {
      await forgot('rita@email.com').expect(204);
      const token = s.mailer.resetTokenFor('rita@email.com');
      s.clock.advance(60 * MINUTE + 1);
      await reset(token, 'uma-senha-nova').expect(400);
      await login('rita@email.com', 'senha-cliente').expect(200);
    });

    it('vale até o último instante', async () => {
      await forgot('rita@email.com').expect(204);
      const token = s.mailer.resetTokenFor('rita@email.com');
      s.clock.advance(60 * MINUTE - 1000);
      await reset(token, 'uma-senha-nova').expect(204);
    });

    it('recusa token inventado e senha curta, sem gastar o link', async () => {
      await forgot('rita@email.com').expect(204);
      const token = s.mailer.resetTokenFor('rita@email.com');
      await reset('token-inventado', 'uma-senha-nova').expect(400);
      await reset('', 'uma-senha-nova').expect(400);
      await reset(token, 'curta').expect(400);
      await reset(token, 'uma-senha-nova').expect(204);
    });

    it('funciona para quem entra pelo painel (admin) e para prestadores', async () => {
      const admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
      await forgot('ana@silva.com').expect(204);
      await reset(s.mailer.resetTokenFor('ana@silva.com'), 'senha-do-painel-2').expect(204);
      await login('ana@silva.com', 'senha-segura').expect(401);
      const res = await login('ana@silva.com', 'senha-do-painel-2').expect(200);
      expect((await http(s).get('/company').set(asUser(res.body.token, admin.companyId)).expect(200)).body.name).toBe('Elétrica Silva');
      await http(s).get('/company').set(asUser(admin.token, admin.companyId)).expect(401); // a sessão antiga saiu
    });

    it('um link não serve para outra conta e não mexe nelas', async () => {
      await clientOf(s, await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com'), 'Bruno', 'bruno@email.com');
      await forgot('rita@email.com').expect(204);
      await reset(s.mailer.resetTokenFor('rita@email.com'), 'senha-so-da-rita').expect(204);
      await login('bruno@email.com', 'senha-cliente').expect(200);
      await login('bruno@email.com', 'senha-so-da-rita').expect(401);
    });
  });
});
