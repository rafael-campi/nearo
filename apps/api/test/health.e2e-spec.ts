import request from 'supertest';
import { createTestApp, type TestApp } from './support/app.js';

describe('GET /health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('confirma Postgres e Redis no ar', async () => {
    const res = await request(t.app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok', redis: 'ok' });
  });

  it('usa o relógio injetado, que os testes conseguem avançar', async () => {
    const before = await request(t.app.getHttpServer()).get('/health');
    t.clock.advance(15 * 60 * 1000);
    const after = await request(t.app.getHttpServer()).get('/health');
    expect(new Date(after.body.time).getTime() - new Date(before.body.time).getTime()).toBe(15 * 60 * 1000);
  });
});
