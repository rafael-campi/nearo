import type { InvitePreview } from "@despacho/shared";
import { Suspense } from "react";
import { Card } from "@/components/form";
import { api } from "@/lib/api";
import { AcceptForm } from "./accept-form";

export default function InvitePage({ params }: PageProps<"/invites/[token]">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card>
        <Suspense fallback={<p className="text-sm text-zinc-500">Carregando convite…</p>}>
          <InviteDetails params={params} />
        </Suspense>
      </Card>
    </main>
  );
}

async function InviteDetails({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await api<InvitePreview>(`/invites/${encodeURIComponent(token)}`);
  if (!res.ok) {
    return (
      <>
        <h1 className="mb-2 text-xl font-semibold">Convite inválido</h1>
        <p className="text-sm text-zinc-500">Este convite expirou ou já foi usado. Peça um novo convite.</p>
      </>
    );
  }
  const invite = res.data;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">{invite.companyName}</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Convite de {invite.role === "admin" ? "administrador" : "prestador"} para <strong>{invite.email}</strong>.
        {invite.hasAccount ? " Você já tem conta: confirme com sua senha." : " Crie sua conta para aceitar."}
      </p>
      <AcceptForm token={token} role={invite.role} hasAccount={invite.hasAccount} />
    </>
  );
}
