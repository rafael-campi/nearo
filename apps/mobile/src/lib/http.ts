/** `fetch` com prazo: numa rede ruim a chamada falha em vez de deixar a tela esperando para sempre. */
export const REQUEST_TIMEOUT_MS = 15_000;

export function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
