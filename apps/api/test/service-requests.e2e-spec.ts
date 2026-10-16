import { sql } from 'drizzle-orm';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { ownerPool, resetState } from './support/db.js';
import {
  asUser,
  categoryOf,
  clientOf,
  companyWithAdmin,
  createScenario,
  http,
  providerOf,
  type Scenario,
} from './support/scenarios.js';

const se = { latitude: -23.5503, longitude: -46.6339 };

describe('cliente cria um pedido', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  let client: string;
  let eletrica: string;
  const asClient = (companyId = admin.companyId) => asUser(client, companyId);
  const asAdmin = () => asUser(admin.token, admin.companyId);
  const body = (overrides: object = {}) => ({
    categoryId: eletrica,
    description: 'Tomada da cozinha soltando faísca',
    location: se,
    addressComplement: 'Apto 32, portão azul',
    ...overrides,
  });
  const create = (overrides: object = {}, companyId = admin.companyId) =>
    http(s).post('/company/service-requests').set(asClient(companyId)).send(body(overrides));

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    s.geocoder.calls.length = 0;
    s.geocoder.answer = 'Sé';
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    eletrica = await categoryOf(s, admin, 'Elétrica');
    client = await clientOf(s, admin, 'Rita', 'rita@email.com');
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  it('cliente vê as categorias ativas da empresa', async () => {
    const pintura = await categoryOf(s, admin, 'Pintura');
    await http(s).patch(`/company/categories/${pintura}`).set(asAdmin()).send({ active: false }).expect(200);
    const res = await http(s).get('/company/category-options').set(asClient()).expect(200);
    expect(res.body).toEqual([{ id: eletrica, name: 'Elétrica' }]);
  });

  it('pedido nasce aberto, com bairro da geocodificação reversa (uma chamada)', async () => {
    const res = await create().expect(201);
    expect(res.body).toMatchObject({
      companyId: admin.companyId,
      companyName: 'Elétrica Silva',
      categoryId: eletrica,
      categoryName: 'Elétrica',
      clientName: 'Rita',
      description: 'Tomada da cozinha soltando faísca',
      location: se,
      addressComplement: 'Apto 32, portão azul',
      neighborhood: 'Sé',
      status: 'open',
    });
    expect(s.geocoder.calls).toEqual([se]);
  });

  it('sem bairro (geocodificação falhou), o pedido é criado mesmo assim', async () => {
    s.geocoder.answer = null;
    const res = await create().expect(201);
    expect(res.body).toMatchObject({ neighborhood: null, status: 'open' });
  });

  it('complemento é opcional', async () => {
    const res = await create({ addressComplement: undefined }).expect(201);
    expect(res.body.addressComplement).toBe('');
  });

  it('cliente pode ter vários pedidos abertos; "Meus pedidos" mostra os mais recentes primeiro', async () => {
    await create({ description: 'Primeiro pedido de teste' }).expect(201);
    s.clock.advance(60_000);
    await create({ description: 'Segundo pedido de teste' }).expect(201);

    const mine = await http(s).get('/my/service-requests').set(asUser(client)).expect(200);
    expect(mine.body.map((r: { description: string }) => r.description)).toEqual([
      'Segundo pedido de teste',
      'Primeiro pedido de teste',
    ]);
  });

  it('admin vê os pedidos da empresa com status', async () => {
    await create().expect(201);
    const res = await http(s).get('/company/service-requests').set(asAdmin()).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ clientName: 'Rita', categoryName: 'Elétrica', status: 'open', neighborhood: 'Sé' });
  });

  it('as listas vêm em páginas, dos mais recentes aos mais antigos', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      s.clock.advance(60_000);
      ids.push((await create().expect(201)).body.id);
    }
    const newestFirst = [...ids].reverse();
    const list = (path: string, headers: Record<string, string>, query: object) => http(s).get(path).set(headers).query(query);

    for (const [path, headers] of [
      ['/company/service-requests', asAdmin()],
      ['/my/service-requests', asClient(admin.companyId)],
    ] as const) {
      const first = (await list(path, headers, { limit: 2 }).expect(200)).body as { id: string; createdAt: string }[];
      expect(first.map((r) => r.id)).toEqual(newestFirst.slice(0, 2));
      const second = (await list(path, headers, { limit: 2, before: first[1].createdAt }).expect(200)).body as { id: string; createdAt: string }[];
      expect(second.map((r) => r.id)).toEqual(newestFirst.slice(2, 4));
      const last = (await list(path, headers, { limit: 2, before: second[1].createdAt }).expect(200)).body;
      expect(last.map((r: { id: string }) => r.id)).toEqual(newestFirst.slice(4));
      expect((await list(path, headers, {}).expect(200)).body).toHaveLength(5);
      await list(path, headers, { limit: 0 }).expect(400);
      await list(path, headers, { limit: 101 }).expect(400);
      await list(path, headers, { before: 'ontem' }).expect(400);
    }
  });

  it('valida categoria, descrição e coordenadas', async () => {
    const pintura = await categoryOf(s, admin, 'Pintura');
    await http(s).patch(`/company/categories/${pintura}`).set(asAdmin()).send({ active: false }).expect(200);

    const inactive = await create({ categoryId: pintura }).expect(400);
    expect(inactive.body.issues[0].message).toBe('Categoria inválida');
    await create({ categoryId: '00000000-0000-0000-0000-000000000000' }).expect(400);
    // Corpo inválido nem chega à geocodificação (serviço externo, com limite de uso).
    s.geocoder.calls.length = 0;
    await create({ description: 'curto' }).expect(400);
    await create({ location: { latitude: 100, longitude: 0 } }).expect(400);
    expect(s.geocoder.calls).toEqual([]);
  });

  it('só cliente cria pedido; só admin lista os da empresa', async () => {
    const provider = await providerOf(s, admin, 'João', 'joao@email.com');
    await http(s).post('/company/service-requests').set(asUser(provider, admin.companyId)).send(body()).expect(404);
    await http(s).post('/company/service-requests').set(asAdmin()).send(body()).expect(404);
    await http(s).get('/company/service-requests').set(asClient()).expect(404);
  });

  it('cliente desativado não cria pedido e deixa de ver os pedidos daquela empresa', async () => {
    await create().expect(201);
    const [rita] = (await http(s).get('/company/clients').set(asAdmin()).expect(200)).body;
    await http(s).patch(`/company/clients/${rita.membershipId}`).set(asAdmin()).send({ active: false }).expect(200);

    await create().expect(404);
    expect((await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body).toEqual([]);
  });

  describe('isolamento entre empresas', () => {
    it('admin de outra empresa não vê os pedidos; categoria de outra empresa é recusada', async () => {
      await create().expect(201);
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const deB = await categoryOf(s, b, 'Hidráulica');
      expect((await http(s).get('/company/service-requests').set(asUser(b.token, b.companyId)).expect(200)).body).toEqual([]);
      await create({ categoryId: deB }).expect(400);
    });

    it('"Meus pedidos" junta as empresas do cliente, sem mostrar pedidos de outros clientes', async () => {
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const hidraulica = await categoryOf(s, b, 'Hidráulica');
      const codeB = (await http(s).get('/company/join-code').set(asUser(b.token, b.companyId)).expect(200)).body.joinCode;
      await http(s).post('/join').set(asUser(client)).send({ code: codeB }).expect(200);
      const other = await clientOf(s, admin, 'Bruno', 'bruno@email.com');

      await create().expect(201);
      await create({ categoryId: hidraulica }, b.companyId).expect(201);
      await http(s).post('/company/service-requests').set(asUser(other, admin.companyId)).send(body()).expect(201);

      const mine = (await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body;
      expect(mine.map((r: { companyName: string }) => r.companyName).sort()).toEqual(['Elétrica Silva', 'Hidráulica Souza']);
      expect(mine.every((r: { clientName: string }) => r.clientName === 'Rita')).toBe(true);
    });

    it('RLS: outra empresa não lê nem altera o pedido; cliente não grava em nome de outro', async () => {
      const created = (await create().expect(201)).body;
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const meB = await http(s).get('/me').set(asUser(b.token)).expect(200);
      const meClient = await http(s).get('/me').set(asUser(client)).expect(200);
      const transactions = s.app.get(TenantTransactions);
      const ctxB = { userId: meB.body.user.id as string, companyId: b.companyId };

      expect(await transactions.run(ctxB, async (tx) => (await tx.execute(sql`select id from service_requests`)).rows)).toEqual([]);
      const changed = await transactions.run(ctxB, async (tx) =>
        (await tx.execute(sql`update service_requests set status = 'cancelled' where id = ${created.id}`)).rowCount,
      );
      expect(changed).toBe(0);

      // Mesmo dentro da empresa, o cliente não cria pedido em nome de outra pessoa.
      await expect(
        transactions.run({ userId: meClient.body.user.id, companyId: admin.companyId }, (tx) =>
          tx.execute(sql`insert into service_requests (company_id, client_id, category_id, description, location)
                         values (${admin.companyId}, ${meB.body.user.id}, ${eletrica}, 'x', st_setsrid(st_makepoint(0, 0), 4326))`),
        ),
      ).rejects.toThrow();
    });
  });
});
