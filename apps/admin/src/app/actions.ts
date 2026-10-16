"use server";

import {
  acceptInviteRequestSchema,
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
  type Category,
  createInviteRequestSchema,
  loginRequestSchema,
  type AcceptInviteResponse,
  type Invite,
  type MeResponse,
  type SessionResponse,
} from "@despacho/shared";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { keepValues, type FormState } from "@/components/form";
import { api, errorMessage } from "@/lib/api";
import { companyApi } from "@/lib/dal";
import { clearSession, getSession, saveSession } from "@/lib/session";

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const values = keepValues(formData, "email");
  const input = loginRequestSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!input.success) return { message: input.error.issues[0].message, values };

  const res = await api<SessionResponse>("/auth/login", { method: "POST", body: input.data });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível entrar"), values };

  const me = await api<MeResponse>("/me", { token: res.data.token });
  // TODO: escolher a empresa quando a pessoa for admin de mais de uma.
  const adminOf = me.data.memberships.find((m) => m.role === "admin");
  if (!adminOf) {
    await api("/auth/logout", { method: "POST", token: res.data.token });
    return { message: "Esta conta não administra nenhuma empresa ativa", values };
  }

  await saveSession(res.data.token, adminOf.companyId);
  redirect("/");
}

export async function acceptInvite(token: string, _: FormState, formData: FormData): Promise<FormState> {
  const values = keepValues(formData, "name");
  const input = acceptInviteRequestSchema.safeParse({
    name: formData.get("name") || undefined,
    password: formData.get("password"),
  });
  if (!input.success) return { message: input.error.issues[0].message, values };
  if (formData.has("confirm") && formData.get("confirm") !== input.data.password) {
    return { message: "As senhas não conferem", values };
  }

  const res = await api<AcceptInviteResponse>(`/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body: input.data,
  });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível aceitar o convite"), values };

  await saveSession(res.data.token, res.data.companyId);
  redirect("/");
}

export async function inviteAdmin(_: FormState, formData: FormData): Promise<FormState> {
  const { token, companyId } = await getSession();
  if (!token || !companyId) redirect("/login");

  const values = keepValues(formData, "email");
  const input = createInviteRequestSchema.safeParse({ email: formData.get("email"), role: "admin" });
  if (!input.success) return { message: input.error.issues[0].message, values };

  const res = await api<Invite>("/company/invites", { method: "POST", body: input.data, token, companyId });
  if (res.status === 401 || res.status === 404) redirect("/login");
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível enviar o convite"), values };
  return { success: true, message: `Convite enviado para ${res.data.email}` };
}

export async function logout(): Promise<void> {
  const { token } = await getSession();
  if (token) await api("/auth/logout", { method: "POST", token });
  await clearSession();
  redirect("/login");
}

export async function createCategory(_: FormState, formData: FormData): Promise<FormState> {
  const values = keepValues(formData, "name");
  const input = createCategoryRequestSchema.safeParse({ name: formData.get("name") });
  if (!input.success) return { message: input.error.issues[0].message, values };

  const res = await companyApi<Category>("/company/categories", { method: "POST", body: input.data });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível criar a categoria"), values };
  refresh();
  return { success: true };
}

export async function renameCategory(id: string, _: FormState, formData: FormData): Promise<FormState> {
  const values = keepValues(formData, "name");
  const input = updateCategoryRequestSchema.safeParse({ name: formData.get("name") });
  if (!input.success) return { message: input.error.issues[0].message, values };

  const res = await companyApi<Category>(`/company/categories/${id}`, { method: "PATCH", body: input.data });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível renomear"), values };
  refresh();
  return { success: true, values: { name: res.data.name } };
}

export async function setCategoryActive(id: string, active: boolean): Promise<void> {
  await companyApi<Category>(`/company/categories/${id}`, { method: "PATCH", body: { active } });
  refresh();
}
