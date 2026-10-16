import { socketEvents } from '@despacho/shared';
import { Redis } from 'ioredis';
import type { Socket } from 'socket.io-client';
import { RealtimeService } from '../src/realtime/realtime.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { ownerPool, resetState } from './support/db.js';
import {
  asUser,
  categoryOf,
  clientOf,
  companyWithAdmin,
  createScenario,
  http,
  readyProvider,
  signupClient,
  type Scenario,
} from './support/scenarios.js';
import { connect, listen } from './support/socket.js';

const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 };
const redis = new Redis(process.env.REDIS_URL!);

const clearCounters = async () => {
  const keys = await redis.keys('rate:*');
  if (keys.length > 0) await redis.del(...keys);
};
const closed = (socket: Socket) => new Promise<void>((resolve) => (socket.disconnected ? resolve() : socket.once('disconnect', () => resolve())));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('limite de tentativas', () => {
  let s: TestApp;

  beforeAll(async () => {
    s = await createTestApp({ config: { RATE_LIMIT: 'on' } });
  });
  beforeEach(async () => {
    await resetState();
    await clearCounters();
  });
  afterAll(async () => {
    await clearCounters();
    await s.app.close();
  });

  it('login: depois de 10 tentativas com o mesmo e-mail, responde 429 mesmo com a senha certa', async () => {
    await signupClient(s, 'Rita Souza', 'rita@email.com');
    const login = (password: string) => http(s).post('/auth/login').send({ email: 'Rita@Email.com ', password });
    for (let i = 0; i < 10; i++) await login('errada-errada').expect(401);
    await login('senha-cliente').expect(429);
    // Outro e-mail, do mesmo IP, ainda passa.
    await http(s).post('/auth/login').send({ email: 'outra@email.com', password: 'x' }).expect(401);
  });

  it('esqueci a senha: depois de 5 pedidos para o mesmo e-mail, responde 429', async () => {
    for (let i = 0; i < 5; i++) await http(s).post('/auth/forgot-password').send({ email: 'rita@email.com' }).expect(204);
    await http(s).post('/auth/forgot-password').send({ email: 'rita@email.com' }).expect(429);
  });

  it('cadastro, redefinição e convite também são limitados', async () => {
    for (let i = 0; i < 10; i++) await http(s).post('/auth/reset-password').send({ token: 'x', password: 'senha-nova-123' }).expect(400);
    await http(s).post('/auth/reset-password').send({ token: 'x', password: 'senha-nova-123' }).expect(429);

    for (let i = 0; i < 10; i++) await http(s).post(`/invites/token-invalido/accept`).send({ password: 'senha-nova-123' }).expect(404);
    await http(s).post(`/invites/token-invalido/accept`).send({ password: 'senha-nova-123' }).expect(429);

    for (let i = 0; i < 10; i++) await http(s).post('/auth/signup').send({ name: 'A', email: `a${i}@email.com`, password: 'senha-cliente' }).expect(201);
    await http(s).post('/auth/signup').send({ name: 'A', email: 'a11@email.com', password: 'senha-cliente' }).expect(429);
  });
});

describe('sockets e sessões revogadas', () => {
  let s: Scenario;
  let url: string;
  let admin: { companyId: string; token: string };
  let client: string;
  let joao: { token: string };
  let requestId: string;
  const sockets: Socket[] = [];
  const at = (token: string) => asUser(token, admin.companyId);

  beforeAll(async () => {
    s = await createScenario();
    url = await listen(s.app);
  });
  beforeEach(async () => {
    await resetState();
    admin = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    const eletrica = await categoryOf(s, admin, 'Elétrica');
    client = await clientOf(s, admin, 'Rita Souza', 'rita@email.com');
    joao = await readyProvider(s, admin, 'João Lima', 'joao@email.com', { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
    requestId = (
      await http(s)
        .post('/company/service-requests')
        .set(at(client))
        .send({ categoryId: eletrica, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body.id;
  });
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });
  afterAll(async () => {
    await s.close();
    redis.disconnect();
  });

  it('sair derruba só os sockets daquela sessão', async () => {
    const other = (await http(s).post('/auth/login').send({ email: 'rita@email.com', password: 'senha-cliente' }).expect(200)).body.token as string;
    const first = await connect(url, client);
    const second = await connect(url, other);
    sockets.push(first, second);
    await http(s).post('/auth/logout').set(asUser(client)).expect(204);
    await closed(first);
    await wait(150);
    expect(second.connected).toBe(true);
  });

  it('trocar a senha derruba os sockets da conta', async () => {
    const socket = await connect(url, client);
    sockets.push(socket);
    await http(s).post('/auth/forgot-password').send({ email: 'rita@email.com' }).expect(204);
    const token = s.mailer.resetTokenFor('rita@email.com');
    await http(s).post('/auth/reset-password').send({ token, password: 'senha-nova-123' }).expect(204);
    await closed(socket);
  });

  it('excluir a conta derruba os sockets', async () => {
    const eve = await signupClient(s, 'Eve', 'eve@email.com');
    const socket = await connect(url, eve);
    sockets.push(socket);
    await http(s).delete('/my/account').set(asUser(eve)).send({ password: 'senha-cliente' }).expect(204);
    await closed(socket);
  });

  it('o prestador que desiste deixa de receber o chat do pedido; o cliente segue recebendo', async () => {
    await http(s).post(`/company/service-requests/${requestId}/accept`).set(at(joao.token)).expect(200);
    await http(s).post(`/company/service-requests/${requestId}/confirm`).set(at(client)).expect(200);
    const providerSocket = await connect(url, joao.token);
    const clientSocket = await connect(url, client);
    sockets.push(providerSocket, clientSocket);
    for (const socket of sockets) {
      expect(await socket.emitWithAck(socketEvents.subscribeServiceRequest, { serviceRequestId: requestId })).toEqual({ ok: true });
    }
    await http(s).post(`/company/service-requests/${requestId}/withdraw`).set(at(joao.token)).send({ reason: 'Imprevisto na estrada' }).expect(204);

    // Tudo o que sai na sala do pedido (chat, status) chega ao cliente e não chega mais ao ex-prestador.
    const heard = { provider: 0, client: 0 };
    providerSocket.on('probe', () => heard.provider++);
    clientSocket.on('probe', () => heard.client++);
    s.app.get(RealtimeService).toServiceRequest(requestId, 'probe', {});
    await wait(250);
    expect(heard).toEqual({ provider: 0, client: 1 });
  });
});

describe('aceite de convites simultâneos', () => {
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

  it('a mesma pessoa convidada por duas empresas e aceitando ao mesmo tempo não dá erro 500', async () => {
    const a = await companyWithAdmin(s, 'Elétrica Silva', 'ana@silva.com');
    const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
    for (const admin of [a, b]) {
      await http(s).post('/company/invites').set(asUser(admin.token, admin.companyId)).send({ email: 'joao@email.com', role: 'provider' }).expect(201);
    }
    const tokens = s.mailer.sent.filter((m) => m.to === 'joao@email.com').map((m) => /invites\/([\w-]+)/.exec(m.text)![1]);
    expect(tokens).toHaveLength(2);
    const results = await Promise.all(
      tokens.map((token) => http(s).post(`/invites/${token}/accept`).send({ name: 'João Lima', password: 'senha-prestador' })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200]);
  });
});
