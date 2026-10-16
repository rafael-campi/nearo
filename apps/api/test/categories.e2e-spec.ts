import { sql } from 'drizzle-orm';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { ownerPool, resetState } from './support/db.js';
import { asUser, companyWithAdmin, createScenario, http, type Scenario } from './support/scenarios.js';

describe('categorias da empresa', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  const as = () => asUser(admin.token, admin.companyId);

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

  const create = (name: string) => http(s).post('/company/categories').set(as()).send({ name });

  it('admin cadastra e lista em ordem alfabética', async () => {
    const created = await create('  Hidráulica ').expect(201);
    expect(created.body).toMatchObject({ name: 'Hidráulica', active: true });
    await create('elétrica').expect(201);

    const list = await http(s).get('/company/categories').set(as()).expect(200);
    expect(list.body.map((c: { name: string }) => c.name)).toEqual(['elétrica', 'Hidráulica']);
  });

  it('renomeia', async () => {
    const { body } = await create('Eletrica').expect(201);
    const res = await http(s).patch(`/company/categories/${body.id}`).set(as()).send({ name: 'Elétrica' }).expect(200);
    expect(res.body).toEqual({ id: body.id, name: 'Elétrica', active: true });
  });

  it('desativa e reativa sem apagar', async () => {
    const { body } = await create('Elétrica').expect(201);
    await http(s).patch(`/company/categories/${body.id}`).set(as()).send({ active: false }).expect(200);

    const list = await http(s).get('/company/categories').set(as()).expect(200);
    expect(list.body).toEqual([{ id: body.id, name: 'Elétrica', active: false }]);

    await http(s).patch(`/company/categories/${body.id}`).set(as()).send({ active: true }).expect(200);
  });

  it('não aceita nome repetido na mesma empresa, sem diferenciar maiúsculas', async () => {
    await create('Elétrica').expect(201);
    const dup = await create('ELÉTRICA').expect(409);
    expect(dup.body.message).toBe('Já existe uma categoria com esse nome');

    const other = await create('Pintura').expect(201);
    await http(s).patch(`/company/categories/${other.body.id}`).set(as()).send({ name: 'elétrica' }).expect(409);
  });

  it('o mesmo nome pode existir em outra empresa', async () => {
    await create('Elétrica').expect(201);
    const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
    await http(s).post('/company/categories').set(asUser(b.token, b.companyId)).send({ name: 'Elétrica' }).expect(201);
  });

  it('valida o corpo', async () => {
    await create('   ').expect(400);
    await create('x'.repeat(61)).expect(400);
    const { body } = await create('Elétrica').expect(201);
    await http(s).patch(`/company/categories/${body.id}`).set(as()).send({}).expect(400);
  });

  it('categoria inexistente responde 404', async () => {
    await http(s)
      .patch('/company/categories/00000000-0000-0000-0000-000000000000')
      .set(as())
      .send({ active: false })
      .expect(404);
    await http(s).patch('/company/categories/nao-e-uuid').set(as()).send({ active: false }).expect(404);
  });

  it('só admin gerencia categorias', async () => {
    await ownerPool.query(`update memberships set role = 'client' where company_id = $1`, [admin.companyId]);
    await http(s).get('/company/categories').set(as()).expect(404);
    await create('Elétrica').expect(404);
  });

  describe('isolamento entre empresas', () => {
    it('admin de uma empresa não vê nem altera categorias de outra', async () => {
      const { body: mine } = await create('Elétrica').expect(201);
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const asB = asUser(b.token, b.companyId);

      const list = await http(s).get('/company/categories').set(asB).expect(200);
      expect(list.body).toEqual([]);
      await http(s).patch(`/company/categories/${mine.id}`).set(asB).send({ active: false }).expect(404);
    });

    it('RLS: agindo em uma empresa, categorias de outra não aparecem nem são gravadas', async () => {
      await create('Elétrica').expect(201);
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const me = await http(s).get('/me').set(asUser(b.token)).expect(200);
      const ctx = { userId: me.body.user.id as string, companyId: b.companyId };
      const transactions = s.app.get(TenantTransactions);

      const seen = await transactions.run(ctx, async (tx) => (await tx.execute(sql`select * from categories`)).rows);
      expect(seen).toEqual([]);
      await expect(
        transactions.run(ctx, (tx) =>
          tx.execute(sql`insert into categories (company_id, name) values (${admin.companyId}, 'Invasão')`),
        ),
      ).rejects.toThrow();
    });
  });
});
