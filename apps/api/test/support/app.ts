import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/clock.js';
import { APP_CONFIG, loadConfig } from '../../src/config.js';
import { ReverseGeocoder } from '../../src/geocoding/reverse-geocoder.js';
import { Mailer } from '../../src/mail/mailer.js';
import { Storage } from '../../src/storage/storage.js';
import { FakeClock } from './fake-clock.js';
import { FakeGeocoder } from './fake-geocoder.js';
import { FakeMailer } from './fake-mailer.js';
import { FakeStorage } from './fake-storage.js';

export interface TestApp {
  app: INestApplication;
  clock: FakeClock;
  mailer: FakeMailer;
  geocoder: FakeGeocoder;
  storage: FakeStorage;
}

export interface TestAppOptions extends ModuleMetadata {
  /** Conecta como outro papel do Postgres (ex.: dono das tabelas, como o script de plataforma). */
  databaseUrl?: string;
  clock?: FakeClock;
  mailer?: FakeMailer;
  geocoder?: FakeGeocoder;
  storage?: FakeStorage;
}

/** Sobe a API inteira com relógio e e-mail falsos. Aceita controllers/providers só de teste. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { databaseUrl, clock = new FakeClock(), mailer = new FakeMailer(), geocoder = new FakeGeocoder(), storage = new FakeStorage(), ...extra } = options;
  const config = loadConfig(process.env);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], ...extra })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(Storage)
    .useValue(storage)
    .overrideProvider(ReverseGeocoder)
    .useValue(geocoder)
    .overrideProvider(APP_CONFIG)
    .useValue({ ...config, DATABASE_URL: databaseUrl ?? config.DATABASE_URL })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, clock, mailer, geocoder, storage };
}
