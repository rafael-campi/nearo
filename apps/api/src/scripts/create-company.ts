// Cria uma empresa e envia o convite do primeiro admin (operação de plataforma, sem painel na v1).
// Uso: pnpm --filter @despacho/api company:create --name "Empresa X" --admin-email admin@x.com
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { emailSchema } from '@despacho/shared';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { CompaniesService } from '../companies/companies.service.js';

const argsSchema = z.object({
  name: z.string().trim().min(1, { error: 'Informe --name' }),
  'admin-email': emailSchema,
});

export async function createCompany(app: INestApplicationContext, argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { name: { type: 'string' }, 'admin-email': { type: 'string' } },
  });
  const args = argsSchema.parse(values);
  return app.get(CompaniesService).createWithAdminInvite(args.name, args['admin-email']);
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // Sem .env: as variáveis vêm do ambiente.
  }
  // Conecta como dono das tabelas: criar empresa é operação fora do RLS.
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const { company, invite } = await createCompany(app, process.argv.slice(2));
    console.log(`Empresa criada: ${company.name} (${company.id})`);
    console.log(`Convite de admin enviado para ${invite.email}, válido até ${invite.expiresAt}`);
  } finally {
    await app.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
