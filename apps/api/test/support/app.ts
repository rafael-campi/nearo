import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/clock.js';
import { APP_CONFIG, loadConfig } from '../../src/config.js';
import { Mailer } from '../../src/mail/mailer.js';
import { FakeClock } from './fake-clock.js';
import { FakeMailer } from './fake-mailer.js';

export interface TestApp {
  app: INestApplication;
  clock: FakeClock;
  mailer: FakeMailer;
}

export interface TestAppOptions extends ModuleMetadata {
  /** Conecta como outro papel do Postgres (ex.: dono das tabelas, como o script de plataforma). */
  databaseUrl?: string;
  clock?: FakeClock;
  mailer?: FakeMailer;
}

/** Sobe a API inteira com relógio e e-mail falsos. Aceita controllers/providers só de teste. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { databaseUrl, clock = new FakeClock(), mailer = new FakeMailer(), ...extra } = options;
  const config = loadConfig(process.env);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], ...extra })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(APP_CONFIG)
    .useValue({ ...config, DATABASE_URL: databaseUrl ?? config.DATABASE_URL })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, clock, mailer };
}
