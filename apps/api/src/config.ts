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
  /** Cloudflare R2 (ADR 0009): fotos do pedido e do chat. Sem isso, a API sobe, mas recusa pedir upload e leitura de fotos. */
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  /** Conta de serviço do Firebase (JSON) para enviar push via FCM. Sem isso, a API sobe e ignora o push. */
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
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
