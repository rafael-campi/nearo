import type { Coordinates } from '@despacho/shared';
import { ReverseGeocoder } from '../../src/geocoding/reverse-geocoder.js';

export class FakeGeocoder extends ReverseGeocoder {
  readonly calls: Coordinates[] = [];
  answer: string | null = 'Sé';

  async neighborhood(point: Coordinates): Promise<string | null> {
    this.calls.push(point);
    return this.answer;
  }
}
