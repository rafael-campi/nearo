// Cria dados de teste via API para medir listas e testar o app no emulador/aparelho: uma empresa, admin,
// um prestador, um cliente, ~40 pedidos abertos e uma conversa de 120 mensagens.
// Uso: node scripts/perf/seed.mjs [api=http://localhost:3000] [log-da-api=/tmp/api.log]
// Contas (senhas): admin@demo.com / senha-segura · joao@demo.com / senha-prestador · rita@demo.com / senha-cliente
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const API = process.argv[2] ?? 'http://localhost:3000';
const LOG = process.argv[3] ?? '/tmp/api.log';
const CENTER = { latitude: -23.5503, longitude: -46.6339 };
const BASE = { latitude: -23.5614, longitude: -46.6559 };
const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

async function call(path, { method = 'GET', body, token, companyId } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (companyId) headers['x-company-id'] = companyId;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

const lastInviteToken = (text, email) => {
  const found = [...strip(text).matchAll(new RegExp(`Para: ${email}[\\s\\S]*?/invites/([\\w-]+)`, 'g'))];
  if (found.length === 0) throw new Error(`Convite de ${email} não encontrado`);
  return found.at(-1)[1];
};

// 1) Empresa + convite do admin (o script de plataforma imprime o e-mail no próprio stdout).
const created = execFileSync('pnpm', ['--filter', '@despacho/api', 'company:create', '--name', 'Elétrica Demo', '--admin-email', 'admin@demo.com'], { encoding: 'utf8' });
const admin = await call(`/invites/${lastInviteToken(created, 'admin@demo.com')}/accept`, { method: 'POST', body: { name: 'Ana Admin', password: 'senha-segura' } });
const at = (token) => ({ token, companyId: admin.companyId });

// 2) Categoria, prestador (convite pelo log da API) e cliente (código de acesso).
const category = await call('/company/categories', { method: 'POST', body: { name: 'Elétrica' }, ...at(admin.token) });
await call('/company/invites', { method: 'POST', body: { email: 'joao@demo.com', role: 'provider' }, ...at(admin.token) });
await new Promise((r) => setTimeout(r, 500));
const joao = await call(`/invites/${lastInviteToken(readFileSync(LOG, 'utf8'), 'joao@demo.com')}/accept`, { method: 'POST', body: { name: 'João Lima', password: 'senha-prestador' } });
const [provider] = await call('/company/providers', at(admin.token));
await call(`/company/providers/${provider.membershipId}/categories`, { method: 'PUT', body: { categoryIds: [category.id] }, ...at(admin.token) });
await call('/company/provider-profile', { method: 'PATCH', body: { baseLocation: BASE, serviceRadiusKm: 30, available: true }, ...at(joao.token) });

const rita = await call('/auth/signup', { method: 'POST', body: { name: 'Rita Souza', email: 'rita@demo.com', password: 'senha-cliente' } });
const { joinCode } = await call('/company/join-code', at(admin.token));
await call('/join', { method: 'POST', body: { code: joinCode }, token: rita.token });
const clientCall = at(rita.token);

// 3) Uma conversa longa: pedido confirmado com 120 mensagens.
const chatRequest = await call('/company/service-requests', { method: 'POST', body: { categoryId: category.id, description: 'Tomada da cozinha soltando faísca', location: CENTER, addressComplement: 'Apto 32' }, ...clientCall });
await call(`/company/service-requests/${chatRequest.id}/accept`, { method: 'POST', ...at(joao.token) });
await call(`/company/service-requests/${chatRequest.id}/confirm`, { method: 'POST', ...clientCall });
for (let i = 1; i <= 120; i++) {
  const who = i % 2 ? clientCall : at(joao.token);
  await call(`/company/service-requests/${chatRequest.id}/messages`, { method: 'POST', body: { clientMessageId: randomUUID(), body: `Mensagem ${i} da conversa de teste` }, ...who });
}

// 4) Conclui a conversa (o prestador fica livre) e cria muitos pedidos abertos: João é avisado de cada um.
for (const status of ['en_route', 'arrived', 'in_progress', 'completed']) {
  await call(`/company/service-requests/${chatRequest.id}/status`, { method: 'POST', body: { status }, ...at(joao.token) });
}
for (let i = 1; i <= 40; i++) {
  await call('/company/service-requests', { method: 'POST', body: { categoryId: category.id, description: `Pedido de teste ${i}: problema elétrico que precisa de visita`, location: { latitude: CENTER.latitude + i * 0.0003, longitude: CENTER.longitude }, addressComplement: `Apto ${i}` }, ...clientCall });
}
console.log('Pronto. João vê 40 pedidos abertos; a conversa de 120 mensagens é do pedido concluído de Rita.');
console.log('Contas: admin@demo.com/senha-segura · joao@demo.com/senha-prestador · rita@demo.com/senha-cliente');
