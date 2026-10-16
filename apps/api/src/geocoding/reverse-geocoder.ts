import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { Coordinates } from '@despacho/shared';
import { APP_CONFIG, type AppConfig } from '../config.js';

/** Geocodificação reversa: o bairro de um ponto. Uma chamada por pedido; falha vira null. */
export abstract class ReverseGeocoder {
  abstract neighborhood(point: Coordinates): Promise<string | null>;
}

export class NoopGeocoder extends ReverseGeocoder {
  async neighborhood(): Promise<string | null> {
    return null;
  }
}

/**
 * Nominatim (OpenStreetMap): sem conta, limite de 1 requisição por segundo e User-Agent identificável
 * (https://operations.osmfoundation.org/policies/nominatim/).
 */
@Injectable()
export class NominatimGeocoder extends ReverseGeocoder {
  private readonly logger = new Logger('NominatimGeocoder');
  private queue: Promise<unknown> = Promise.resolve();

  async neighborhood({ latitude, longitude }: Coordinates): Promise<string | null> {
    const run = this.queue.then(() => this.lookup(latitude, longitude));
    // Espaça as chamadas em 1 s, respeitando o limite do serviço.
    this.queue = run.then(
      () => new Promise((r) => setTimeout(r, 1000)),
      () => new Promise((r) => setTimeout(r, 1000)),
    );
    return run;
  }

  private async lookup(latitude: number, longitude: number): Promise<string | null> {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({
      format: 'jsonv2',
      lat: String(latitude),
      lon: String(longitude),
      zoom: '16',
      addressdetails: '1',
    }).toString();
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'Despacho/0.1 (+https://github.com/rafael-campi/nearo)',
          'accept-language': 'pt-BR',
        },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { address?: Record<string, string> };
      const a = body.address ?? {};
      return a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? a.village ?? a.town ?? null;
    } catch (error) {
      this.logger.warn(`Bairro não obtido para ${latitude},${longitude}: ${(error as Error).message}`);
      return null;
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: ReverseGeocoder,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.GEOCODER === 'nominatim' ? new NominatimGeocoder() : new NoopGeocoder()),
    },
  ],
  exports: [ReverseGeocoder],
})
export class GeocodingModule {}
