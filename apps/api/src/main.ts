import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

try {
  process.loadEnvFile();
} catch {
  // Sem .env: as variáveis vêm do ambiente.
}

async function bootstrap() {
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Atrás do Caddy (um proxy): o IP de quem chama vem do X-Forwarded-For, para o limite de tentativas.
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  if (config.CORS_ORIGINS.length > 0) app.enableCors({ origin: config.CORS_ORIGINS });
  await app.listen(config.PORT);
}
await bootstrap();
