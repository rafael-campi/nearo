"use server";

import {
  acceptInviteRequestSchema,
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
  type Category,
  type Client,
  createInviteRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  loginRequestSchema,
  type AcceptInviteResponse,
  type Company,
  reasonRequestSchema,
  updateCompanySettingsRequestSchema,
  type Invite,
  type MembershipRole,
  type Provider,
  setProviderCategoriesRequestSchema,
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

export async function acceptInvite(
  token: string,
  role: MembershipRole,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = keepValues(formData, "name", "phone");
  const input = acceptInviteRequestSchema.safeParse({
    name: formData.get("name") || undefined,
    phone: formData.get("phone") || undefined,
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

  // Prestador trabalha pelo app, não pelo painel: encerra a sessão criada pelo aceite.
  if (role !== "admin") {
    await api("/auth/logout", { method: "POST", token: res.data.token });
    return { success: true, message: "Convite aceito! Agora entre no app Despacho com seu e-mail e senha." };
  }
  await saveSession(res.data.token, res.data.companyId);
  redirect("/");
}

export async function invite(role: "admin" | "provider", _: FormState, formData: FormData): Promise<FormState> {
  const { token, companyId } = await getSession();
  if (!token || !companyId) redirect("/login");

  const values = keepValues(formData, "email");
  const input = createInviteRequestSchema.safeParse({ email: formData.get("email"), role });
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

export async function setClientActive(membershipId: string, active: boolean): Promise<void> {
  await companyApi<Client>(`/company/clients/${membershipId}`, { method: "PATCH", body: { active } });
  refresh();
}

export async function setProviderActive(membershipId: string, active: boolean): Promise<void> {
  await companyApi<Provider>(`/company/providers/${membershipId}`, { method: "PATCH", body: { active } });
  refresh();
}

export async function setProviderCategories(membershipId: string, _: FormState, formData: FormData): Promise<FormState> {
  const input = setProviderCategoriesRequestSchema.safeParse({ categoryIds: formData.getAll("categoryId") });
  if (!input.success) return { message: "Categoria inválida" };
  const res = await companyApi<Provider>(`/company/providers/${membershipId}/categories`, { method: "PUT", body: input.data });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível salvar as categorias") };
  refresh();
  return { success: true, message: "Categorias salvas" };
}

export async function setAssignmentMode(_: FormState, formData: FormData): Promise<FormState> {
  const input = updateCompanySettingsRequestSchema.safeParse({ assignmentMode: formData.get("assignmentMode") });
  if (!input.success) return { message: "Escolha um modo de atribuição" };
  const res = await companyApi<Company>("/company/settings", { method: "PATCH", body: input.data });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível salvar") };
  refresh();
  return { success: true, message: "Modo de atribuição salvo" };
}

export async function assignRequest(requestId: string, providerMembershipId: string): Promise<FormState> {
  const res = await companyApi(`/company/service-requests/${requestId}/assign`, { method: "POST", body: { providerMembershipId } });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível atribuir") };
  refresh();
  return { success: true, message: "Pedido atribuído" };
}

export async function markNotificationsRead(): Promise<void> {
  await companyApi("/my/notifications/read", { method: "POST" });
  refresh();
}

export async function cancelRequest(requestId: string, _: FormState, formData: FormData): Promise<FormState> {
  const input = reasonRequestSchema.safeParse({ reason: formData.get("reason") });
  if (!input.success) return { message: input.error.issues[0].message, values: { reason: String(formData.get("reason") ?? "") } };
  const res = await companyApi(`/company/service-requests/${requestId}/admin-cancel`, { method: "POST", body: input.data });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível cancelar") };
  refresh();
  return { success: true, message: "Pedido cancelado" };
}

export async function forgotPassword(_: FormState, formData: FormData): Promise<FormState> {
  const values = keepValues(formData, "email");
  const input = forgotPasswordRequestSchema.safeParse({ email: formData.get("email") });
  if (!input.success) return { message: input.error.issues[0].message, values };
  const res = await api("/auth/forgot-password", { method: "POST", body: input.data });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível enviar o link"), values };
  // A mesma resposta exista ou não a conta: o painel também não revela quais e-mails estão cadastrados.
  return { success: true, message: "Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha. Ele vale por 1 hora." };
}

export async function resetPassword(token: string, _: FormState, formData: FormData): Promise<FormState> {
  const input = resetPasswordRequestSchema.safeParse({ token, password: formData.get("password") });
  if (!input.success) return { message: input.error.issues[0].message };
  if (formData.get("confirm") !== input.data.password) return { message: "As senhas não conferem" };
  const res = await api("/auth/reset-password", { method: "POST", body: input.data });
  if (!res.ok) return { message: errorMessage(res.data, "Não foi possível redefinir a senha") };
  return { success: true, message: "Senha redefinida! Você já pode entrar com a senha nova." };
}
