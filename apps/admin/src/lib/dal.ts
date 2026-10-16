import "server-only";
import type { Company } from "@despacho/shared";
import { redirect } from "next/navigation";
import { api, type ApiResult } from "./api";
import { getSession } from "./session";

/** Empresa do admin logado. Sem sessão válida, vai para o login. */
export async function getCurrentCompany(): Promise<Company> {
  const { token, companyId } = await getSession();
  if (!token || !companyId) redirect("/login");
  const res = await api<Company>("/company", { token, companyId });
  if (!res.ok) redirect("/login");
  return res.data;
}

/** Chamada autenticada na empresa atual. Sessão inválida vai para o login. */
export async function companyApi<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const { token, companyId } = await getSession();
  if (!token || !companyId) redirect("/login");
  const res = await api<T>(path, { ...options, token, companyId });
  if (res.status === 401) redirect("/login");
  return res;
}
