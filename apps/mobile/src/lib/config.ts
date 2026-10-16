/**
 * URL da API. No emulador Android, use http://10.0.2.2:3000; num aparelho, o IP da máquina na rede
 * (ex.: http://192.168.1.7:3000). Defina em apps/mobile/.env como EXPO_PUBLIC_API_URL.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
