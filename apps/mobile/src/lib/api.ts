import { COMPANY_HEADER } from '@despacho/shared';
import { ApiError } from './api-error';
import { API_URL } from './config';
import { fetchWithTimeout } from './http';
import { useSession } from './session';

function messageOf(body: unknown, fallback: string): string {
  const b = body as { message?: unknown; issues?: { message: string }[] } | undefined;
  if (b?.issues?.length) return b.issues[0].message;
  return typeof b?.message === 'string' ? b.message : fallback;
}

/** Chamada à API com a sessão atual. Sessão recusada (401) desloga. */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; companyId?: string } = {},
): Promise<T> {
  const { token } = useSession.getState();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.companyId) headers[COMPANY_HEADER] = options.companyId;

  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  const text = await res.text();
  // Resposta que não é JSON (ex.: página de erro de um proxy) vira erro comum, não exceção.
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    if (res.status === 401 && token) await useSession.getState().signOut();
    throw new ApiError(res.status, messageOf(body, 'Algo deu errado. Tente de novo.'));
  }
  return body as T;
}
