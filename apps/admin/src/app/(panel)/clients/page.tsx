import type { Client, JoinCodeResponse } from "@despacho/shared";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { companyApi } from "@/lib/dal";
import { ClientToggle } from "./client-toggle";

export default function ClientsPage() {
  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="mb-1 text-lg font-semibold">Clientes</h1>
        <p className="text-sm text-zinc-500">
          Clientes entram na empresa pelo app, com o código de acesso abaixo.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando código…</p>}>
        <JoinCode />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando clientes…</p>}>
        <ClientList />
      </Suspense>
    </section>
  );
}

async function JoinCode() {
  const res = await companyApi<JoinCodeResponse>("/company/join-code");
  if (!res.ok) redirect("/login");
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500">Código de acesso</p>
      <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.2em]" aria-label="Código de acesso">
        {res.data.joinCode}
      </p>
      <p className="mt-3 text-sm text-zinc-500">
        Link para o app: <span className="font-mono">despacho://join/{res.data.joinCode}</span>
      </p>
    </div>
  );
}

async function ClientList() {
  const res = await companyApi<Client[]>("/company/clients");
  if (!res.ok) redirect("/login");
  if (res.data.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhum cliente ainda.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
      {res.data.map((client) => (
        <li key={client.membershipId} className="flex items-center gap-3 px-4 py-3">
          <div className={`flex-1 ${client.active ? "" : "text-zinc-400"}`}>
            <p className="text-sm font-medium">{client.name}</p>
            <p className="text-sm text-zinc-500">{client.email}</p>
          </div>
          {!client.active && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Desativado</span>
          )}
          <ClientToggle client={client} />
        </li>
      ))}
    </ul>
  );
}
