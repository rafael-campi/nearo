import { Global, Module } from '@nestjs/common';

/** Fonte de tempo da API. Injetada para que os testes controlem prazos sem esperar. */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class ClockModule {}
