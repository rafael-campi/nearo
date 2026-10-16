// Desativa uma empresa e cancela os pedidos não concluídos (operação de plataforma, sem painel na v1).
// Uso: pnpm --filter @despacho/api company:deactivate --id <uuid-da-empresa>
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { CompaniesService } from '../companies/companies.service.js';

const argsSchema = z.object({ id: z.uuid({ error: 'Informe --id com o id da empresa' }) });

export async function deactivateCompany(app: INestApplicationContext, argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { id: { type: 'string' } } });
  const args = argsSchema.parse(values);
  return app.get(CompaniesService).deactivate(args.id);
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // Sem .env: as variáveis vêm do ambiente.
  }
  // Conecta como dono das tabelas: desativar empresa é operação fora do RLS.
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
  // Script de plataforma não processa filas: sem workers, o processo termina ao fechar.
  process.env.WORKERS = 'off';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const cancelled = await deactivateCompany(app, process.argv.slice(2));
    console.log(`Empresa desativada. Pedidos cancelados: ${cancelled}`);
  } finally {
    await app.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
