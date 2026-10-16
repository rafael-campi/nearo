import { Clock } from '../../src/clock.js';

export class FakeClock extends Clock {
  private current: Date;

  constructor(start = new Date('2026-01-01T12:00:00.000Z')) {
    super();
    this.current = start;
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
