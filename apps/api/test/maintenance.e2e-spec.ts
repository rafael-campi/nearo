import { MaintenanceService, UNUSED_UPLOAD_TTL_MS } from '../src/maintenance/maintenance.service.js';
import { ownerPool, resetState } from './support/db.js';
import { categoryOf, clientOf, companyWithAdmin, createScenario, http, asUser, type Scenario } from './support/scenarios.js';

describe('limpeza diária', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await createScenario();
  });
  beforeEach(async () => {
    await resetState();
  });
  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  it('apaga sessões vencidas e links de redefinição vencidos, e guarda o que ainda vale', async () => {
    const admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    const rita = await clientOf(s, admin, 'Rita Souza', 'rita@email.com');
    await http(s).post('/auth/forgot-password').send({ email: 'rita@email.com' }).expect(204);
    const { rows: before } = await ownerPool.query(`select count(*)::int as n from sessions`);
    expect(before[0].n).toBeGreaterThan(1);

    // Só a sessão da Rita vence; o link de redefinição dela também.
    await ownerPool.query(`update sessions set expires_at = $1 where token_hash = encode(sha256($2::bytea), 'hex')`, [new Date(s.clock.now().getTime() - 1000), rita]);
    await ownerPool.query(`update password_resets set expires_at = $1`, [new Date(s.clock.now().getTime() - 3 * 24 * 60 * 60_000)]);

    const result = await s.app.get(MaintenanceService).purgeStale();
    expect(result.authRows).toBe(2);
    await http(s).get('/me').set(asUser(rita)).expect(401);
    await http(s).get('/me').set(asUser(admin.token)).expect(200);
    const { rows: resets } = await ownerPool.query(`select count(*)::int as n from password_resets`);
    expect(resets[0].n).toBe(0);
  });

  it('apaga os uploads sem uso depois de um dia, junto com o arquivo; os usados ficam', async () => {
    const admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    await categoryOf(s, admin, 'Elétrica');
    const rita = await clientOf(s, admin, 'Rita Souza', 'rita@email.com');
    const upload = async () =>
      (await http(s).post('/company/uploads').set(asUser(rita, admin.companyId)).send({ purpose: 'request_photo', contentLength: 1000 }).expect(201)).body.key as string;
    const unused = await upload();
    const used = await upload();
    await ownerPool.query(`update uploads set used_at = now() where key = $1`, [used]);

    s.clock.advance(UNUSED_UPLOAD_TTL_MS - 60_000);
    await ownerPool.query(`update uploads set created_at = $1`, [s.clock.now()]);
    s.clock.advance(61_000);
    expect(await s.app.get(MaintenanceService).purgeStale()).toMatchObject({ uploads: 0 });

    s.clock.advance(UNUSED_UPLOAD_TTL_MS);
    expect(await s.app.get(MaintenanceService).purgeStale()).toMatchObject({ uploads: 1 });
    expect(s.storage.deleted).toEqual([unused]);
    const { rows } = await ownerPool.query(`select key from uploads`);
    expect(rows).toEqual([{ key: used }]);
  });
});
