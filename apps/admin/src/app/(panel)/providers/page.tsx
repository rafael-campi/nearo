import type { Category, Provider } from "@despacho/shared";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { InviteForm } from "@/components/invite-form";
import { companyApi } from "@/lib/dal";
import { ProviderRow } from "./provider-row";

export default function ProvidersPage() {
  return (
    <section className="flex flex-col gap-8">
      <div className="max-w-sm">
        <h1 className="mb-1 text-lg font-semibold">Prestadores</h1>
        <p className="mb-4 text-sm text-zinc-500">
          Convide quem executa os serviços. O prestador aceita pelo e-mail e trabalha pelo app.
        </p>
        <InviteForm role="provider" label="E-mail do prestador" />
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando prestadores…</p>}>
        <ProviderList />
      </Suspense>
    </section>
  );
}

async function ProviderList() {
  const [providers, categories] = await Promise.all([
    companyApi<Provider[]>("/company/providers"),
    companyApi<Category[]>("/company/categories"),
  ]);
  if (!providers.ok || !categories.ok) redirect("/login");
  if (providers.data.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhum prestador ainda.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
      {providers.data.map((provider) => (
        <ProviderRow key={provider.membershipId} provider={provider} categories={categories.data} />
      ))}
    </ul>
  );
}
