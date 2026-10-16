import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_URL } from './config';

export const PUSH_TOKEN_KEY = 'despacho.push-token';

/**
 * Remove o token do aparelho da conta que está saindo, para a próxima pessoa não receber o push dela.
 * Fica separado de `push.ts` para o logout não depender do cliente da API (que depende da sessão).
 */
export async function unregisterDeviceToken(sessionToken: string | null): Promise<void> {
  if (Platform.OS === 'web' || !sessionToken) return;
  try {
    const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    if (!token) return;
    await fetch(`${API_URL}/my/device-token`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ token }),
    });
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  } catch {
    // Sem rede: o token continua gravado e é reassumido por quem entrar neste aparelho.
  }
}
