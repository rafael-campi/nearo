import { randomUUID } from 'node:crypto';
import { MAX_REQUEST_PHOTOS, PHOTO_MAX_BYTES } from '@despacho/shared';
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
  readyProvider,
  type Scenario,
} from './support/scenarios.js';

const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 };

describe('fotos no pedido e no chat', () => {
  let s: Scenario;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  let joao: { token: string; membershipId: string };
  const at = (token: string, companyId = admin.companyId) => asUser(token, companyId);
  const upload = (token: string, purpose: string, contentLength = 120_000, companyId = admin.companyId) =>
    http(s).post('/company/uploads').set(at(token, companyId)).send({ purpose, contentLength });
  const photoKey = async (token: string, purpose: 'request_photo' | 'chat_photo', companyId = admin.companyId) =>
    (await upload(token, purpose, 120_000, companyId).expect(201)).body.key as string;
  const create = (token: string, photoKeys: string[], companyId = admin.companyId) =>
    http(s)
      .post('/company/service-requests')
      .set(at(token, companyId))
      .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32', photoKeys });
  const keys = async (n: number) => Promise.all(Array.from({ length: n }, () => photoKey(client, 'request_photo')));

  beforeAll(async () => {
    s = await createScenario();
  });

  beforeEach(async () => {
    await resetState();
    s.mailer.sent.length = 0;
    s.storage.uploads.length = 0;
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    eletrica = await categoryOf(s, admin, 'Elétrica');
    client = await clientOf(s, admin, 'Rita Souza', 'rita@email.com');
    joao = await readyProvider(s, admin, 'João Lima', 'joao@email.com', { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  describe('URL assinada de envio', () => {
    it('devolve a chave da empresa, o endereço de envio e registra quem pediu', async () => {
      const res = await upload(client, 'request_photo', 98_765).expect(201);
      expect(res.body).toEqual({
        key: expect.stringMatching(new RegExp(`^${admin.companyId}/[0-9a-f-]{36}\\.jpg$`)),
        uploadUrl: `https://storage.test/upload/${res.body.key}`,
        headers: { 'content-type': 'image/jpeg' },
      });
      expect(s.storage.uploads).toEqual([{ key: res.body.key, contentLength: 98_765 }]);
      const { rows } = await ownerPool.query(`select purpose, used_at from uploads where key = $1`, [res.body.key]);
      expect(rows).toEqual([{ purpose: 'request_photo', used_at: null }]);
    });

    it('limita o tamanho e o propósito', async () => {
      await upload(client, 'request_photo', 0).expect(400);
      await upload(client, 'request_photo', PHOTO_MAX_BYTES + 1).expect(400);
      await upload(client, 'request_photo', PHOTO_MAX_BYTES).expect(201);
      await upload(client, 'outro').expect(400);
    });

    it('foto do pedido só o cliente pede; foto do chat, cliente e prestador; admin não pede', async () => {
      await upload(joao.token, 'request_photo').expect(404);
      await upload(joao.token, 'chat_photo').expect(201);
      await upload(client, 'chat_photo').expect(201);
      await upload(admin.token, 'chat_photo').expect(404);
      await upload(admin.token, 'request_photo').expect(404);
    });
  });

  describe('fotos do pedido', () => {
    it('anexa até 5 fotos na criação, na ordem, e o cliente e o admin as veem', async () => {
      const photoKeys = await keys(3);
      const created = (await create(client, photoKeys).expect(201)).body;
      const expected = photoKeys.map((k) => `https://storage.test/read/${k}`);
      expect(created.photos).toEqual(expected);

      const mine = (await http(s).get('/my/service-requests').set(asUser(client)).expect(200)).body;
      expect(mine[0].photos).toEqual(expected);
      const forAdmin = (await http(s).get(`/company/service-requests/${created.id}`).set(at(admin.token)).expect(200)).body;
      expect(forAdmin.photos).toEqual(expected);
    });

    it('sem fotos continua funcionando', async () => {
      const created = (await create(client, []).expect(201)).body;
      expect(created.photos).toEqual([]);
      await http(s)
        .post('/company/service-requests')
        .set(at(client))
        .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se })
        .expect(201);
    });

    it(`aceita ${MAX_REQUEST_PHOTOS} fotos e recusa mais que isso`, async () => {
      await create(client, await keys(MAX_REQUEST_PHOTOS)).expect(201);
      await create(client, await keys(MAX_REQUEST_PHOTOS + 1)).expect(400);
    });

    it('recusa chave desconhecida, repetida, já usada, de outra pessoa ou de outro propósito', async () => {
      const [a, b] = await keys(2);
      await create(client, [`${admin.companyId}/${randomUUID()}.jpg`]).expect(400);
      await create(client, [a, a]).expect(400);

      await create(client, [a]).expect(201);
      await create(client, [a]).expect(400); // já usada em outro pedido

      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      await create(bruno, [b]).expect(400); // emitida para a Rita
      const chat = await photoKey(client, 'chat_photo');
      const res = await create(client, [chat]).expect(400); // propósito errado
      expect(res.body.issues[0].path).toBe('photoKeys');
      // A falha não consome as outras chaves.
      await create(client, [b]).expect(201);
    });

    it('o prestador apto vê as fotos na visão reduzida; depois de aceitar, nos seus pedidos', async () => {
      const photoKeys = await keys(2);
      const created = (await create(client, photoKeys).expect(201)).body;
      const [open] = (await http(s).get('/company/open-requests').set(at(joao.token)).expect(200)).body;
      expect(open.photos).toEqual(photoKeys.map((k) => `https://storage.test/read/${k}`));

      await http(s).post(`/company/service-requests/${created.id}/accept`).set(at(joao.token)).expect(200);
      const [mine] = (await http(s).get('/company/provider-requests').set(at(joao.token)).expect(200)).body;
      expect(mine.photos).toHaveLength(2);
    });

    it('quem não é apto não vê as fotos', async () => {
      await create(client, await keys(1)).expect(201);
      const longe = await readyProvider(s, admin, 'Longe', 'longe@email.com', {
        categoryIds: [eletrica],
        base: { latitude: -23.5025, longitude: -46.6252 },
        radiusKm: 1,
      });
      expect(JSON.stringify((await http(s).get('/company/open-requests').set(at(longe.token)).expect(200)).body)).not.toContain('storage.test');
    });
  });

  describe('fotos no chat', () => {
    let requestId: string;
    beforeEach(async () => {
      requestId = (await create(client, []).expect(201)).body.id;
      await http(s).post(`/company/service-requests/${requestId}/accept`).set(at(joao.token)).expect(200);
      await http(s).post(`/company/service-requests/${requestId}/confirm`).set(at(client)).expect(200);
    });
    const send = (token: string, body: object) =>
      http(s).post(`/company/service-requests/${requestId}/messages`).set(at(token)).send(body);

    it('uma foto por mensagem, com ou sem texto; os dois lados a veem', async () => {
      const withText = await send(client, { clientMessageId: randomUUID(), body: 'Olha a tomada', photoKey: await photoKey(client, 'chat_photo') }).expect(200);
      expect(withText.body.photoUrl).toMatch(/^https:\/\/storage\.test\/read\//);
      const photoOnly = await send(joao.token, { clientMessageId: randomUUID(), photoKey: await photoKey(joao.token, 'chat_photo') }).expect(200);
      expect(photoOnly.body).toMatchObject({ body: '', photoUrl: expect.any(String) });

      for (const token of [client, joao.token, admin.token]) {
        const page = (await http(s).get(`/company/service-requests/${requestId}/messages`).set(at(token)).expect(200)).body;
        expect(page.messages.map((m: { body: string; photoUrl: string | null }) => [m.body, m.photoUrl !== null])).toEqual([
          ['Olha a tomada', true],
          ['', true],
        ]);
      }
    });

    it('mensagem sem texto e sem foto é recusada', async () => {
      await send(client, { clientMessageId: randomUUID(), body: '   ' }).expect(400);
      await send(client, { clientMessageId: randomUUID() }).expect(400);
    });

    it('chave inválida, de outra pessoa ou de propósito errado é recusada', async () => {
      const mineKey = await photoKey(client, 'chat_photo');
      await send(client, { clientMessageId: randomUUID(), photoKey: `${admin.companyId}/${randomUUID()}.jpg` }).expect(400);
      await send(joao.token, { clientMessageId: randomUUID(), photoKey: mineKey }).expect(400);
      await send(client, { clientMessageId: randomUUID(), photoKey: await photoKey(client, 'request_photo') }).expect(400);
      await send(client, { clientMessageId: randomUUID(), photoKey: mineKey }).expect(200);
      await send(client, { clientMessageId: randomUUID(), photoKey: mineKey }).expect(400); // já usada
    });

    it('reenviar a mesma mensagem com foto devolve a original sem gastar a chave de novo', async () => {
      const key = await photoKey(client, 'chat_photo');
      const clientMessageId = randomUUID();
      const first = await send(client, { clientMessageId, photoKey: key }).expect(200);
      const again = await send(client, { clientMessageId, photoKey: key }).expect(200);
      expect(again.body).toEqual(first.body);
      expect((await ownerPool.query(`select count(*)::int as n from messages`)).rows[0].n).toBe(1);
    });
  });

  describe('isolamento entre empresas', () => {
    it('outra empresa não obtém link de leitura nem usa chaves alheias; o RLS esconde fotos e envios', async () => {
      const photoKeys = await keys(2);
      const created = (await create(client, [photoKeys[0]]).expect(201)).body;

      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const eletricaB = await categoryOf(s, b, 'Elétrica');
      const deB = await clientOf(s, b, 'Rita B', 'ritab@email.com');
      // O pedido e suas fotos não aparecem para a outra empresa.
      await http(s).get(`/company/service-requests/${created.id}`).set(asUser(b.token, b.companyId)).expect(404);
      expect((await http(s).get('/company/service-requests').set(asUser(b.token, b.companyId)).expect(200)).body).toEqual([]);
      expect((await http(s).get('/my/service-requests').set(asUser(deB)).expect(200)).body).toEqual([]);
      // Chave emitida em A não vale em B, nem para o mesmo cliente nem para outro.
      await http(s)
        .post('/company/service-requests')
        .set(asUser(deB, b.companyId))
        .send({ categoryId: eletricaB, description: 'Torneira vazando muito', location: se, photoKeys: [photoKeys[1]] })
        .expect(400);

      const me = (await http(s).get('/me').set(asUser(b.token)).expect(200)).body;
      const transactions = s.app.get(TenantTransactions);
      const asB = { userId: me.user.id as string, companyId: b.companyId };
      for (const table of ['uploads', 'service_request_photos']) {
        expect(await transactions.run(asB, async (tx) => (await tx.execute(sql.raw(`select * from ${table}`))).rows)).toEqual([]);
      }
      // O cliente dono lê as fotos dos próprios pedidos sem contexto de empresa; outro cliente, não.
      const asClient = { userId: (await http(s).get('/me').set(asUser(client)).expect(200)).body.user.id as string, companyId: null };
      expect((await transactions.run(asClient, async (tx) => (await tx.execute(sql`select * from service_request_photos`)).rows)).length).toBe(1);
      const asOther = { userId: (await http(s).get('/me').set(asUser(deB)).expect(200)).body.user.id as string, companyId: null };
      expect(await transactions.run(asOther, async (tx) => (await tx.execute(sql`select * from service_request_photos`)).rows)).toEqual([]);
    });
  });
});
