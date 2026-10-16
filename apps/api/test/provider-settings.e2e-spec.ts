import { sql } from 'drizzle-orm';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { ownerPool, resetState } from './support/db.js';
import { asUser, companyWithAdmin, createScenario, http, providerOf, type Scenario } from './support/scenarios.js';

// Praça da Sé e Avenida Paulista, em São Paulo.
const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 };

describe('endereço-base, área de atendimento e disponibilidade', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  let provider: string;
  const asProvider = (companyId = admin.companyId) => asUser(provider, companyId);
  const profile = async (companyId = admin.companyId) =>
    (await http(s).get('/company/provider-profile').set(asProvider(companyId)).expect(200)).body;
  const update = (body: object, companyId = admin.companyId) =>
    http(s).patch('/company/provider-profile').set(asProvider(companyId)).send(body);

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    provider = await providerOf(s, admin, 'João', 'joao@email.com');
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  it('prestador novo: sem endereço-base, raio de 20 km e indisponível', async () => {
    expect(await profile()).toEqual({ baseLocation: null, serviceRadiusKm: 20, available: false, categories: [] });
  });

  it('sem endereço-base não fica disponível', async () => {
    const res = await update({ available: true }).expect(400);
    expect(res.body.issues[0].message).toBe('Cadastre seu endereço-base antes de ficar disponível');
    expect((await profile()).available).toBe(false);
  });

  it('cadastra endereço-base e raio, depois fica disponível', async () => {
    const saved = await update({ baseLocation: se, serviceRadiusKm: 8 }).expect(200);
    expect(saved.body).toMatchObject({ baseLocation: se, serviceRadiusKm: 8, available: false });

    await update({ available: true }).expect(200);
    await update({ baseLocation: paulista }).expect(200);
    expect(await profile()).toMatchObject({ baseLocation: paulista, serviceRadiusKm: 8, available: true });

    await update({ available: false }).expect(200);
    expect((await profile()).available).toBe(false);
  });

  it('endereço e disponível podem ir juntos no primeiro ajuste', async () => {
    await update({ baseLocation: se, available: true }).expect(200);
    expect(await profile()).toMatchObject({ baseLocation: se, available: true });
  });

  it('valida raio, coordenadas e corpo vazio', async () => {
    await update({ serviceRadiusKm: 0 }).expect(400);
    await update({ serviceRadiusKm: 101 }).expect(400);
    await update({ baseLocation: { latitude: 91, longitude: 0 } }).expect(400);
    await update({}).expect(400);
  });

  it('guarda um ponto PostGIS em WGS 84 que mede distância em metros', async () => {
    await update({ baseLocation: se }).expect(200);
    const { rows } = await ownerPool.query(
      `select st_srid(base_location) as srid,
              st_distance(base_location::geography, st_setsrid(st_makepoint($1, $2), 4326)::geography) as meters
         from provider_profiles`,
      [paulista.longitude, paulista.latitude],
    );
    expect(rows[0].srid).toBe(4326);
    expect(rows[0].meters).toBeGreaterThan(2000);
    expect(rows[0].meters).toBeLessThan(3000);
  });

  it('admin vê endereço-base, raio e disponível de cada prestador', async () => {
    await update({ baseLocation: se, serviceRadiusKm: 12, available: true }).expect(200);
    const list = await http(s).get('/company/providers').set(asUser(admin.token, admin.companyId)).expect(200);
    expect(list.body[0]).toMatchObject({ name: 'João', baseLocation: se, serviceRadiusKm: 12, available: true });
  });

  it('cada empresa tem sua própria atuação', async () => {
    const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
    await providerOf(s, b, 'João', 'joao@email.com');

    await update({ baseLocation: se, serviceRadiusKm: 5, available: true }).expect(200);
    expect(await profile(b.companyId)).toMatchObject({ baseLocation: null, serviceRadiusKm: 20, available: false });

    await update({ baseLocation: paulista, serviceRadiusKm: 30 }, b.companyId).expect(200);
    expect(await profile()).toMatchObject({ baseLocation: se, serviceRadiusKm: 5, available: true });
  });

  describe('isolamento entre empresas', () => {
    it('prestador não ajusta atuação em empresa onde não é prestador', async () => {
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      await update({ baseLocation: se }, b.companyId).expect(404);
      await http(s).get('/company/provider-profile').set(asProvider(b.companyId)).expect(404);
    });

    it('admin não ajusta a atuação do prestador (é do próprio prestador)', async () => {
      await http(s)
        .patch('/company/provider-profile')
        .set(asUser(admin.token, admin.companyId))
        .send({ available: false })
        .expect(404);
    });

    it('RLS: atuação de prestador de outra empresa não aparece nem é gravada', async () => {
      await update({ baseLocation: se }).expect(200);
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const meB = await http(s).get('/me').set(asUser(b.token)).expect(200);
      const ctx = { userId: meB.body.user.id as string, companyId: b.companyId };
      const transactions = s.app.get(TenantTransactions);
      const { rows } = await ownerPool.query(`select membership_id from provider_profiles`);

      expect(await transactions.run(ctx, async (tx) => (await tx.execute(sql`select * from provider_profiles`)).rows)).toEqual([]);
      const changed = await transactions.run(ctx, async (tx) =>
        (await tx.execute(sql`update provider_profiles set available = true where membership_id = ${rows[0].membership_id}`))
          .rowCount,
      );
      expect(changed).toBe(0);
    });
  });
});
