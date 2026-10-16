import Link from "next/link";
import { Suspense } from "react";
import { getCurrentCompany } from "@/lib/dal";
import { logout } from "../actions";

const nav = [
  { href: "/requests", label: "Pedidos" },
  { href: "/categories", label: "Categorias" },
  { href: "/providers", label: "Prestadores" },
  { href: "/clients", label: "Clientes" },
  { href: "/admins", label: "Administradores" },
  { href: "/notifications", label: "Atualizações" },
  { href: "/settings", label: "Configurações" },
] as const;

export default function PanelLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-8 border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <Suspense fallback={<span className="font-semibold text-zinc-400">Despacho</span>}>
          <CompanyName />
        </Suspense>
        <nav className="flex flex-1 gap-5 text-sm">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50">
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={logout}>
          <button type="submit" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Sair
          </button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-3xl p-6">{children}</main>
    </div>
  );
}

async function CompanyName() {
  const company = await getCurrentCompany();
  return <span className="font-semibold">{company.name}</span>;
}
