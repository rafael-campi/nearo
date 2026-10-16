import { COMPANY_HEADER } from '@despacho/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createCompany } from '../../src/scripts/create-company.js';
import { createTestApp, type TestApp } from './app.js';
import { testEnv } from './env.js';

/**
 * API como o app usa (despacho_app, sujeita a RLS) e um contexto de plataforma
 * (dono das tabelas, como o script `company:create`), compartilhando relógio e e-mail.
 */
export interface Scenario extends TestApp {
  platform: INestApplication;
  close(): Promise<void>;
}

export async function createScenario(): Promise<Scenario> {
  const api = await createTestApp();
  const { app: platform } = await createTestApp({
    databaseUrl: testEnv.MIGRATION_DATABASE_URL,
    clock: api.clock,
    mailer: api.mailer,
    geocoder: api.geocoder,
    storage: api.storage,
  });
  return {
    ...api,
    platform,
    async close() {
      await platform.close();
      await api.app.close();
    },
  };
}

export const http = (s: TestApp) => request(s.app.getHttpServer());

export function asUser(token: string, companyId?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (companyId) headers[COMPANY_HEADER] = companyId;
  return headers;
}

/** Roda o script de criação de empresa e aceita o convite do primeiro admin. */
export async function companyWithAdmin(s: Scenario, name: string, adminEmail: string) {
  const { company } = await createCompany(s.platform, ['--name', name, '--admin-email', adminEmail]);
  const res = await http(s)
    .post(`/invites/${s.mailer.inviteTokenFor(adminEmail)}/accept`)
    .send({ name: `Admin ${name}`, password: 'senha-segura' })
    .expect(200);
  return { companyId: company.id, token: res.body.token as string };
}

/** Cliente se cadastra sozinho; devolve o token da sessão. */
export async function signupClient(s: TestApp, name: string, email: string): Promise<string> {
  const res = await http(s).post('/auth/signup').send({ name, email, password: 'senha-cliente' }).expect(201);
  return res.body.token;
}

export async function joinCodeOf(s: TestApp, admin: { token: string; companyId: string }): Promise<string> {
  const res = await http(s).get('/company/join-code').set(asUser(admin.token, admin.companyId)).expect(200);
  return res.body.joinCode;
}

/** Admin convida um prestador e ele aceita criando conta; devolve o token da sessão. */
export async function providerOf(
  s: TestApp,
  admin: { token: string; companyId: string },
  name: string,
  email: string,
  password = 'senha-prestador',
): Promise<string> {
  await http(s)
    .post('/company/invites')
    .set(asUser(admin.token, admin.companyId))
    .send({ email, role: 'provider' })
    .expect(201);
  const res = await http(s)
    .post(`/invites/${s.mailer.inviteTokenFor(email)}/accept`)
    .send({ name, password })
    .expect(200);
  return res.body.token;
}

/** Cliente cadastrado e já dentro da empresa; devolve o token. */
export async function clientOf(
  s: TestApp,
  admin: { token: string; companyId: string },
  name: string,
  email: string,
): Promise<string> {
  const token = await signupClient(s, name, email);
  const code = await joinCodeOf(s, admin);
  await http(s).post('/join').set(asUser(token)).send({ code }).expect(200);
  return token;
}

export async function categoryOf(s: TestApp, admin: { token: string; companyId: string }, name: string): Promise<string> {
  const res = await http(s).post('/company/categories').set(asUser(admin.token, admin.companyId)).send({ name }).expect(201);
  return res.body.id;
}

/** Prestador pronto para receber pedidos: categorias, endereço-base, raio e disponível. */
export async function readyProvider(
  s: TestApp,
  admin: { token: string; companyId: string },
  name: string,
  email: string,
  options: {
    categoryIds: string[];
    base: { latitude: number; longitude: number } | null;
    radiusKm?: number;
    available?: boolean;
    /** Senha atual, se a pessoa já tem conta. */
    password?: string;
  },
): Promise<{ token: string; membershipId: string }> {
  const token = await providerOf(s, admin, name, email, options.password);
  const providers = (await http(s).get('/company/providers').set(asUser(admin.token, admin.companyId)).expect(200)).body;
  const membershipId = providers.find((p: { email: string }) => p.email === email).membershipId;
  await http(s)
    .put(`/company/providers/${membershipId}/categories`)
    .set(asUser(admin.token, admin.companyId))
    .send({ categoryIds: options.categoryIds })
    .expect(200);
  if (options.base) {
    await http(s)
      .patch('/company/provider-profile')
      .set(asUser(token, admin.companyId))
      .send({ baseLocation: options.base, serviceRadiusKm: options.radiusKm ?? 20, available: options.available ?? true })
      .expect(200);
  }
  return { token, membershipId };
}
