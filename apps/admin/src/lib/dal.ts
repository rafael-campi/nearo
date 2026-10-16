import "server-only";
import type { Company } from "@despacho/shared";
import { redirect } from "next/navigation";
import { api } from "./api";
import { getSession } from "./session";

/** Empresa do admin logado. Sem sessão válida, vai para o login. */
export async function getCurrentCompany(): Promise<Company> {
  const { token, companyId } = await getSession();
  if (!token || !companyId) redirect("/login");
  const res = await api<Company>("/company", { token, companyId });
  if (!res.ok) redirect("/login");
  return res.data;
}
