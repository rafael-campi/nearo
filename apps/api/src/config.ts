import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Base dos links enviados por e-mail (convites). */
  ADMIN_URL: z.url().default('http://localhost:3001'),
  /** Geocodificação reversa (bairro do pedido): `nominatim` (OpenStreetMap) ou `none`. */
  GEOCODER: z.enum(['nominatim', 'none']).default('nominatim'),
  /** Worker dos prazos do pedido (BullMQ). Os testes o desligam e varrem os prazos vencidos à mão. */
  WORKERS: z.enum(['on', 'off']).default('on'),
  /** Origens liberadas por CORS, separadas por vírgula (ex.: Expo web em dev). O app nativo não precisa. */
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) => value?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? []),
});

export type AppConfig = z.infer<typeof configSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return configSchema.parse(env);
}
