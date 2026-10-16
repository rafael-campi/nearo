import "server-only";
import { COMPANY_HEADER } from "@despacho/shared";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

/** Chamada à API a partir do servidor do painel. */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; companyId?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.companyId) headers[COMPANY_HEADER] = options.companyId;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}

/** Primeira mensagem de erro de uma resposta da API, para mostrar no formulário. */
export function errorMessage(data: unknown, fallback: string): string {
  const body = data as { message?: unknown; issues?: { message: string }[] } | undefined;
  if (body?.issues?.length) return body.issues[0].message;
  return typeof body?.message === "string" ? body.message : fallback;
}
