import { sql } from 'drizzle-orm';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { ownerPool, resetState } from './support/db.js';
import { companyWithAdmin, createScenario, http, asUser, type Scenario } from './support/scenarios.js';

// Prova no Postgres, sem passar pelos filtros da API, que empresas, vínculos e convites
// de uma empresa não aparecem para quem age em outra (ADR 0001).
describe('RLS de empresas, vínculos e convites', () => {
  let s: Scenario;
  let transactions: TenantTransactions;
  let a: { companyId: string; userId: string };
  let b: { companyId: string; userId: string };

  beforeAll(async () => {
    s = await createScenario();
    transactions = s.app.get(TenantTransactions);
    await resetState();

    const setup = async (name: string, email: string, invitee: string) => {
      const { companyId, token } = await companyWithAdmin(s, name, email);
      await http(s)
        .post('/company/invites')
        .set(asUser(token, companyId))
        .send({ email: invitee, role: 'admin' })
        .expect(201);
      const me = await http(s).get('/me').set(asUser(token)).expect(200);
      return { companyId, userId: me.body.user.id as string };
    };
    a = await setup('Elétrica Silva', 'ana@silva.com', 'bia@silva.com');
    b = await setup('Hidráulica Souza', 'caio@souza.com', 'davi@souza.com');
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  const select = (ctx: { userId: string; companyId: string | null }, table: string) =>
    transactions.run(ctx, async (tx) => {
      const result = await tx.execute<{ company_id: string }>(
        sql.raw(`select ${table === 'companies' ? 'id as company_id' : 'company_id'} from ${table}`),
      );
      return result.rows.map((r) => r.company_id);
    });

  it.each(['companies', 'memberships', 'invites'])('%s: agindo na empresa A, só aparecem linhas de A', async (table) => {
    const seen = await select({ userId: a.userId, companyId: a.companyId }, table);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([a.companyId]));
  });

  it('sem empresa no contexto, a pessoa vê só os próprios vínculos e empresas', async () => {
    expect(await select({ userId: a.userId, companyId: null }, 'memberships')).toEqual([a.companyId]);
    expect(await select({ userId: a.userId, companyId: null }, 'companies')).toEqual([a.companyId]);
    expect(await select({ userId: a.userId, companyId: null }, 'invites')).toEqual([]);
  });

  it('não grava vínculo nem convite em outra empresa', async () => {
    const ctx = { userId: a.userId, companyId: a.companyId };
    await expect(
      transactions.run(ctx, (tx) =>
        tx.execute(sql`insert into memberships (company_id, user_id, role) values (${b.companyId}, ${a.userId}, 'admin')`),
      ),
    ).rejects.toThrow();
    await expect(
      transactions.run(ctx, (tx) =>
        tx.execute(
          sql`insert into invites (company_id, email, role, token_hash, expires_at)
              values (${b.companyId}, 'x@x.com', 'admin', 'hash', now() + interval '1 day')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('não altera outra empresa', async () => {
    const changed = await transactions.run({ userId: a.userId, companyId: a.companyId }, async (tx) => {
      const result = await tx.execute(sql`update companies set name = 'invadida' where id = ${b.companyId}`);
      return result.rowCount;
    });
    expect(changed).toBe(0);
  });
});
