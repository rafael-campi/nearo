import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

try {
  process.loadEnvFile();
} catch {
  // Sem .env: as variáveis vêm do ambiente.
}

async function bootstrap() {
  const config = loadConfig(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  if (config.CORS_ORIGINS.length > 0) app.enableCors({ origin: config.CORS_ORIGINS });
  await app.listen(config.PORT);
}
await bootstrap();
