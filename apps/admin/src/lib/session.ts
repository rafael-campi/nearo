import "server-only";
import { cookies } from "next/headers";

const SESSION_COOKIE = "despacho_session";
const COMPANY_COOKIE = "despacho_company";
const MAX_AGE = 30 * 24 * 60 * 60;

export interface Session {
  token?: string;
  companyId?: string;
}

export async function getSession(): Promise<Session> {
  const store = await cookies();
  return {
    token: store.get(SESSION_COOKIE)?.value,
    companyId: store.get(COMPANY_COOKIE)?.value,
  };
}

/** Só em Server Actions: cookies não podem ser gravados durante a renderização. */
export async function saveSession(token: string, companyId: string): Promise<void> {
  const store = await cookies();
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  };
  store.set(SESSION_COOKIE, token, options);
  store.set(COMPANY_COOKIE, companyId, options);
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(COMPANY_COOKIE);
}
