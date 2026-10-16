import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile();
} catch {
  // Sem .env: as variáveis vêm do ambiente.
}

// Migrations rodam como dono das tabelas (despacho), não como despacho_app.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL! },
});
