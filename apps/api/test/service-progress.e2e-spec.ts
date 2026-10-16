import { socketEvents } from '@despacho/shared';
import type { Socket } from 'socket.io-client';
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
import { connect, listen, nextEvent } from './support/socket.js';

const se = { latitude: -23.5503, longitude: -46.6339 };
const paulista = { latitude: -23.5614, longitude: -46.6559 };

describe('atendimento: do a caminho ao concluído', () => {
  let s: Scenario;
  let url: string;
  let admin: { companyId: string; token: string };
  let eletrica: string;
  let client: string;
  const sockets: Socket[] = [];
  const at = (token: string) => asUser(token, admin.companyId);
  const createRequest = async (companyAdmin = admin, clientToken = client, category = eletrica) =>
    (
      await http(s)
        .post('/company/service-requests')
        .set(asUser(clientToken, companyAdmin.companyId))
        .send({ categoryId: category, description: 'Tomada da cozinha soltando faísca', location: se, addressComplement: 'Apto 32' })
        .expect(201)
    ).body;
  const ready = (name: string, email: string) =>
    readyProvider(s, admin, name, email, { categoryIds: [eletrica], base: paulista, radiusKm: 5 });
  const confirmed = async (token: string, requestClient = client) => {
    const request = await createRequest(admin, requestClient);
    await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(token)).expect(200);
    await http(s).post(`/company/service-requests/${request.id}/confirm`).set(at(requestClient)).expect(200);
    return request;
  };
  const step = (token: string, id: string, status: string) =>
    http(s).post(`/company/service-requests/${id}/status`).set(at(token)).send({ status });
  const statusOf = async (id: string) =>
    (await http(s).get(`/company/service-requests/${id}`).set(asUser(admin.token, admin.companyId)).expect(200)).body.status as string;
  const openFor = async (token: string, companyId = admin.companyId) =>
    (await http(s).get('/company/open-requests').set(asUser(token, companyId)).expect(200)).body;

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
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await s.close();
    await ownerPool.end();
  });

  it('percorre confirmado → a caminho → chegou → em execução → concluído, guardando quando cada passo ocorreu', async () => {
    const joao = await ready('João Lima', 'joao@email.com');
    const request = await confirmed(joao.token);

    for (const status of ['en_route', 'arrived', 'in_progress', 'completed']) {
      s.clock.advance(60_000);
      const res = await step(joao.token, request.id, status).expect(200);
      expect(res.body).toEqual({ id: request.id, status });
      expect(await statusOf(request.id)).toBe(status);
    }
    const { rows } = await ownerPool.query(`select en_route_at, arrived_at, started_at, completed_at from service_requests`);
    const times = Object.values(rows[0]).map((t) => (t as Date).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(4);
  });

  it('só o prestador do pedido, e só o próximo passo', async () => {
    const joao = await ready('João', 'joao@email.com');
    const maria = await ready('Maria', 'maria@email.com');
    const request = await confirmed(joao.token);

    await step(joao.token, request.id, 'arrived').expect(409);
    await step(joao.token, request.id, 'completed').expect(409);
    await step(joao.token, request.id, 'confirmed').expect(400);
    await step(maria.token, request.id, 'en_route').expect(404);
    await step(client, request.id, 'en_route').expect(404);
    await step(admin.token, request.id, 'en_route').expect(404);
    await step(joao.token, request.id, 'en_route').expect(200);
    await step(joao.token, request.id, 'en_route').expect(409);
  });

  it('não avança pedido que ainda não foi confirmado', async () => {
    const joao = await ready('João', 'joao@email.com');
    const request = await createRequest();
    await http(s).post(`/company/service-requests/${request.id}/accept`).set(at(joao.token)).expect(200);
    await step(joao.token, request.id, 'en_route').expect(409);
  });

  it('o cliente recebe as mudanças pelo socket e na lista de atualizações', async () => {
    const joao = await ready('João Lima', 'joao@email.com');
    const request = await confirmed(joao.token);
    const clientSocket = await connect(url, client);
    sockets.push(clientSocket);

    const updated = nextEvent(clientSocket, socketEvents.serviceRequestUpdated);
    const notified = nextEvent<{ type: string; title: string }>(clientSocket, socketEvents.notification);
    await step(joao.token, request.id, 'en_route').expect(200);
    expect(await updated).toEqual({ id: request.id, companyId: admin.companyId, status: 'en_route' });
    expect(await notified).toMatchObject({ type: 'request_status', title: 'João está a caminho' });

    await step(joao.token, request.id, 'arrived').expect(200);
    await step(joao.token, request.id, 'in_progress').expect(200);
    await step(joao.token, request.id, 'completed').expect(200);
    const titles = (await http(s).get('/my/notifications').set(asUser(client)).expect(200)).body
      .filter((n: { type: string }) => n.type === 'request_status')
      .map((n: { title: string }) => n.title);
    expect(titles).toHaveLength(4);
    expect(titles).toEqual(expect.arrayContaining(['João está a caminho', 'João chegou', 'João iniciou o serviço', 'Serviço concluído']));
  });

  describe('um pedido ativo por pessoa', () => {
    it('com pedido ativo o prestador deixa de ser apto; ao concluir, volta a ser', async () => {
      const joao = await ready('João', 'joao@email.com');
      const request = await confirmed(joao.token);
      await createRequest();
      expect(await openFor(joao.token)).toEqual([]);

      for (const status of ['en_route', 'arrived', 'in_progress']) {
        await step(joao.token, request.id, status).expect(200);
        expect(await openFor(joao.token)).toEqual([]);
      }
      await step(joao.token, request.id, 'completed').expect(200);
      expect(await openFor(joao.token)).toHaveLength(1);
    });

    it('vale somando todas as empresas: pedido ativo numa empresa tira a aptidão nas outras', async () => {
      const joao = await ready('João', 'joao@email.com');
      const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
      const eletricaB = await categoryOf(s, b, 'Elétrica');
      const joaoB = await readyProvider(s, b, 'João', 'joao@email.com', {
        categoryIds: [eletricaB],
        base: paulista,
        radiusKm: 5,
        password: 'senha-prestador',
      });
      const clientB = await clientOf(s, b, 'Bruno', 'bruno@email.com');

      const request = await confirmed(joao.token);
      const requestB = await createRequest(b, clientB, eletricaB);
      expect(await openFor(joaoB.token, b.companyId)).toEqual([]);
      await http(s).post(`/company/service-requests/${requestB.id}/accept`).set(asUser(joaoB.token, b.companyId)).expect(404);

      for (const status of ['en_route', 'arrived', 'in_progress', 'completed']) await step(joao.token, request.id, status).expect(200);
      expect(await openFor(joaoB.token, b.companyId)).toHaveLength(1);
    });
  });

  it('prestador de outra empresa não avança o pedido', async () => {
    const joao = await ready('João', 'joao@email.com');
    const request = await confirmed(joao.token);
    const b = await companyWithAdmin(s, 'Hidráulica Souza', 'caio@souza.com');
    const eletricaB = await categoryOf(s, b, 'Elétrica');
    const carlos = await readyProvider(s, b, 'Carlos', 'carlos@email.com', { categoryIds: [eletricaB], base: paulista });
    await http(s)
      .post(`/company/service-requests/${request.id}/status`)
      .set(asUser(carlos.token, b.companyId))
      .send({ status: 'en_route' })
      .expect(404);
    expect(await statusOf(request.id)).toBe('confirmed');
  });
});
