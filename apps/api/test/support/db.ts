import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { testEnv } from './env.js';

/** Conexão como dono das tabelas: ignora RLS. Só para preparar e limpar cenários. */
export const ownerPool = new Pool({ connectionString: testEnv.MIGRATION_DATABASE_URL });

/** Apaga todas as linhas das tabelas do domínio e o Redis de testes. */
export async function resetState(): Promise<void> {
  const { rows } = await ownerPool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys'`,
  );
  if (rows.length > 0) {
    await ownerPool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(', ')} cascade`);
  }
  const redis = new Redis(testEnv.REDIS_URL);
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}
