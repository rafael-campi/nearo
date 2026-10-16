import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentCompany } from "@/lib/dal";
import { ModeForm } from "./mode-form";

export default function SettingsPage() {
  return (
    <section>
      <h1 className="mb-1 text-lg font-semibold">Configurações</h1>
      <p className="mb-6 text-sm text-zinc-500">Como os pedidos novos chegam aos prestadores.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando…</p>}>
        <Mode />
      </Suspense>
    </section>
  );
}

async function Mode() {
  const company = await getCurrentCompany().catch(() => redirect("/login"));
  return <ModeForm mode={company.assignmentMode} />;
}
