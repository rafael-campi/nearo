import { socketEvents } from '@despacho/shared';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Socket } from 'socket.io-client';
import { TenantTransactions } from '../src/db/tenant-transactions.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { ownerPool, resetState } from './support/db.js';
import { testEnv } from './support/env.js';
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
import { connect, listen, nextEvent } from './support/socket.js';

const se = { latitude: -23.5503, longitude: -46.6339 }; // endereço do pedido
const paulista = { latitude: -23.5614, longitude: -46.6559 }; // ~2,6 km
const perto = { latitude: -23.5535, longitude: -46.6339 }; // ~355 m
const longe = { latitude: -23.5503, longitude: -46.6459 }; // ~1,2 km

describe('GPS ao vivo e raio de aviso', () => {
  let s: Scenario;
  let url: string;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  let joao: { token: string; membershipId: string };
  let requestId: string;
  const sockets: Socket[] = [];
  const at = (token: string) => asUser(token, admin.companyId);
  const send = (token: string, position: { latitude: number; longitude: number }, id = requestId) =>
    http(s).post(`/company/service-requests/${id}/location`).set(at(token)).send(position);
  const lastSeenBy = (token: string, id = requestId, companyId = admin.companyId) =>
    http(s).get(`/company/service-requests/${id}/location`).set(asUser(token, companyId));
  const step = (status: string) =>
    http(s).post(`/company/service-requests/${requestId}/status`).set(at(joao.token)).send({ status }).expect(200);
  const nearby = async () =>
    (await http(s).get('/my/notifications').set(asUser(client)).expect(200)).body.filter((n: { type: string }) => n.type === 'provider_nearby');
  const storedPoints = async () => (await ownerPool.query(`select count(*)::int as n from provider_positions`)).rows[0].n as number;
  const redis = new Redis(testEnv.REDIS_URL);

  beforeAll(async () => {
    s = await createScenario();
    url = await listen(s.app);
  });

  beforeEach(async () => {
    await resetState();
    s.mailer.sent.length = 0;
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    eletrica = await categoryOf(s, admin, 'Elétrica');
    client = await clientOf(s, admin, 'Rita Souza', 'rita@email.com');
    joao = await readyProvider(s, admin, 'João Lima', 'joao@email.com', { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
    requestId = (
      await http(s)
        .post('/company/service-requests')
        .set(at(client))
        .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body.id;
    await http(s).post(`/company/service-requests/${requestId}/accept`).set(at(joao.token)).expect(200);
    await http(s).post(`/company/service-requests/${requestId}/confirm`).set(at(client)).expect(200);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await redis.quit();
    await s.close();
    await ownerPool.end();
  });

  describe('quem pode enviar', () => {
    it('só o prestador do pedido e só em a caminho', async () => {
      const maria = await readyProvider(s, admin, 'Maria', 'maria@email.com', { categoryIds: [eletrica], base: paulista });
      await send(joao.token, paulista).expect(409); // ainda confirmado
      await step('en_route');

      await send(maria.token, paulista).expect(404);
      await send(client, paulista).expect(404);
      await send(admin.token, paulista).expect(404);
      await send(joao.token, { latitude: 91, longitude: 0 }).expect(400);
      await send(joao.token, paulista).expect(204);
    });

    it('depois de chegar, a posição deixa de ser aceita, guardada e exposta', async () => {
      await step('en_route');
      await send(joao.token, paulista).expect(204);
      expect((await lastSeenBy(client)).body).toMatchObject({ latitude: paulista.latitude, longitude: paulista.longitude });

      await step('arrived');
      await send(joao.token, perto).expect(409);
      expect((await lastSeenBy(client).expect(200)).body).toEqual({});
      expect(await redis.get(`gps:last:${requestId}`)).toBeNull();
    });
  });

  describe('última posição', () => {
    it('o cliente do pedido lê a última posição; outros não', async () => {
      await step('en_route');
      expect((await lastSeenBy(client).expect(200)).body).toEqual({});
      await send(joao.token, paulista).expect(204);
      await send(joao.token, longe).expect(204);

      const res = await lastSeenBy(client).expect(200);
      expect(res.body).toEqual({ ...longe, at: expect.any(String) });
      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      await lastSeenBy(bruno).expect(404);
      await lastSeenBy(joao.token).expect(404);
      await lastSeenBy(admin.token).expect(404);
    });

    it('o cliente recebe cada posição pelo socket', async () => {
      await step('en_route');
      const clientSocket = await connect(url, client);
      sockets.push(clientSocket);
      const event = nextEvent(clientSocket, socketEvents.serviceRequestLocation);
      await send(joao.token, paulista).expect(204);
      expect(await event).toEqual({ id: requestId, ...paulista, at: expect.any(String) });
    });

    it('a posição de um prestador não chega a quem não é o cliente do pedido', async () => {
      await step('en_route');
      const bruno = await clientOf(s, admin, 'Bruno', 'bruno@email.com');
      const brunoSocket = await connect(url, bruno);
      const adminSocket = await connect(url, admin.token);
      sockets.push(brunoSocket, adminSocket);
      let leaked = 0;
      for (const socket of [brunoSocket, adminSocket]) socket.on(socketEvents.serviceRequestLocation, () => leaked++);
      const clientSocket = await connect(url, client);
      sockets.push(clientSocket);
      const arrived = nextEvent(clientSocket, socketEvents.serviceRequestLocation);
      await send(joao.token, paulista).expect(204);
      await arrived;
      expect(leaked).toBe(0);
    });
  });

  describe('trilha no Postgres', () => {
    it('um ponto a cada ~30 s, mesmo com envios a cada 10 s', async () => {
      await step('en_route');
      await send(joao.token, paulista).expect(204);
      expect(await storedPoints()).toBe(1);
      for (let i = 0; i < 2; i++) {
        s.clock.advance(10_000);
        await send(joao.token, perto).expect(204);
      }
      expect(await storedPoints()).toBe(1);
      s.clock.advance(10_000);
      await send(joao.token, perto).expect(204);
      expect(await storedPoints()).toBe(2);
    });

    it('retenção de 30 dias: a limpeza apaga só o que passou disso, e está agendada todo dia', async () => {
      await step('en_route');
      await send(joao.token, paulista).expect(204);
      await ownerPool.query(
        `insert into provider_positions (company_id, service_request_id, location, recorded_at)
         select company_id, id, location, $1::timestamptz - interval '31 days' from service_requests`,
        [s.clock.now().toISOString()],
      );
      await ownerPool.query(
        `insert into provider_positions (company_id, service_request_id, location, recorded_at)
         select company_id, id, location, $1::timestamptz - interval '29 days' from service_requests`,
        [s.clock.now().toISOString()],
      );
      expect(await storedPoints()).toBe(3);
      expect(await s.app.get(MaintenanceService).purgePositions()).toBe(1);
      expect(await storedPoints()).toBe(2);

      // O Redis é limpo a cada teste; o registro do agendador é idempotente e roda ao subir a API.
      await s.app.get(MaintenanceService).onModuleInit();
      const queue = new Queue('maintenance', { connection: new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: null }) });
      try {
        const schedulers = await queue.getJobSchedulers();
        expect(schedulers.map((j) => [j.key, j.pattern])).toEqual([['purge-positions', '0 3 * * *']]);
      } finally {
        await queue.close();
      }
    });
  });

  describe('raio de aviso (500 m)', () => {
    it('avisa o cliente uma única vez ao entrar no raio', async () => {
      await step('en_route');
      await send(joao.token, longe).expect(204);
      expect(await nearby()).toEqual([]);

      await send(joao.token, perto).expect(204);
      const list = await nearby();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ title: 'João está chegando', serviceRequestId: requestId });

      // Sai do raio e volta: sem novo aviso.
      await send(joao.token, longe).expect(204);
      await send(joao.token, perto).expect(204);
      await send(joao.token, se).expect(204);
      expect(await nearby()).toHaveLength(1);
    });

    it('envios simultâneos dentro do raio geram um único aviso', async () => {
      await step('en_route');
      await Promise.all([1, 2, 3, 4].map(() => send(joao.token, perto).expect(204)));
      expect(await nearby()).toHaveLength(1);
    });
  });

  describe('isolamento entre empresas', () => {
    it('outra empresa não envia, não lê e a trilha não aparece (RLS)', async () => {
      await step('en_route');
      await send(joao.token, paulista).expect(204);
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const eletricaB = await categoryOf(s, b, 'Elétrica');
      const carlos = await readyProvider(s, b, 'Carlos', 'carlos@email.com', { categoryIds: [eletricaB], base: paulista });
      const deB = await clientOf(s, b, 'Rita B', 'ritab@email.com');
      await http(s).post(`/company/service-requests/${requestId}/location`).set(asUser(carlos.token, b.companyId)).send(paulista).expect(404);
      await lastSeenBy(deB, requestId, b.companyId).expect(404);

      const me = (await http(s).get('/me').set(asUser(b.token)).expect(200)).body;
      const rows = await s.app
        .get(TenantTransactions)
        .run({ userId: me.user.id, companyId: b.companyId }, async (tx) => (await tx.execute(sql`select * from provider_positions`)).rows);
      expect(rows).toEqual([]);
    });
  });
});
