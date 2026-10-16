import { Suspense } from "react";
import { getCurrentCompany } from "@/lib/dal";
import { logout } from "./actions";
import { InviteAdminForm } from "./invite-admin-form";

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <Suspense fallback={<span className="text-sm text-zinc-500">Despacho</span>}>
          <CompanyName />
        </Suspense>
        <form action={logout}>
          <button type="submit" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Sair
          </button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-3xl p-6">
        <section className="max-w-sm">
          <h2 className="mb-1 text-lg font-semibold">Administradores</h2>
          <p className="mb-4 text-sm text-zinc-500">Convide outra pessoa para administrar a empresa.</p>
          <InviteAdminForm />
        </section>
      </main>
    </div>
  );
}

async function CompanyName() {
  const company = await getCurrentCompany();
  return <h1 className="font-semibold">{company.name}</h1>;
}
