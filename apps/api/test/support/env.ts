// Ambiente dos testes e2e: banco despacho_test e Redis db 1, ambos de infra/docker-compose.yml.
export const testEnv = {
  DATABASE_URL: 'postgres://despacho_app:despacho_app@localhost:5433/despacho_test',
  MIGRATION_DATABASE_URL: 'postgres://despacho:despacho@localhost:5433/despacho_test',
  REDIS_URL: 'redis://localhost:6379/1',
};
