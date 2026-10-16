import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_URL } from './config';
import { fetchWithTimeout } from './http';

export const PUSH_TOKEN_KEY = 'despacho.push-token';
// Sair não pode ficar esperando a rede.
const LOGOUT_TIMEOUT_MS = 5_000;

/**
 * Encerra a sessão no servidor (o token deixa de valer) e remove o token de push do aparelho, para a
 * próxima pessoa não receber o push desta conta. Falha de rede não impede a saída: o app limpa o que é
 * local de qualquer jeito. Fica separado de `push.ts` para o logout não depender do cliente da API.
 */
export async function endServerSession(sessionToken: string | null): Promise<void> {
  if (!sessionToken) return;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` };
  const unregisterPush = async () => {
    if (Platform.OS === 'web') return;
    const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    if (!token) return;
    await fetchWithTimeout(`${API_URL}/my/device-token`, { method: 'DELETE', headers, body: JSON.stringify({ token }) }, LOGOUT_TIMEOUT_MS);
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  };
  // O push sai primeiro (precisa da sessão), e então a sessão é revogada.
  try {
    await unregisterPush();
  } catch {
    // Sem rede: o token continua gravado e é reassumido por quem entrar neste aparelho.
  }
  try {
    await fetchWithTimeout(`${API_URL}/auth/logout`, { method: 'POST', headers }, LOGOUT_TIMEOUT_MS);
  } catch {
    // Sem rede: a sessão expira sozinha em 30 dias.
  }
}
