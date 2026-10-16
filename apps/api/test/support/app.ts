import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/clock.js';
import { FakeClock } from './fake-clock.js';

export interface TestApp {
  app: INestApplication;
  clock: FakeClock;
}

/** Sobe a API inteira com relógio falso. `extra` permite registrar controllers/providers só de teste. */
export async function createTestApp(extra: ModuleMetadata = {}): Promise<TestApp> {
  const clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], ...extra })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, clock };
}
