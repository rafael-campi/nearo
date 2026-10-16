import { REQUESTS_PAGE_SIZE, type ServiceRequest } from "@despacho/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { StatusBadge } from "@/components/status-badge";
import { companyApi } from "@/lib/dal";

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export default function RequestsPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  return (
    <section>
      <h1 className="mb-1 text-lg font-semibold">Pedidos</h1>
      <p className="mb-6 text-sm text-zinc-500">Todos os pedidos da empresa, mais recentes primeiro.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando pedidos…</p>}>
        <RequestTable searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function RequestTable({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  const res = await companyApi<ServiceRequest[]>(`/company/service-requests${query}`);
  // Data inválida na URL (400) ou sessão perdida: recomeça do início em vez de mandar para o login.
  if (res.status === 400) redirect("/requests");
  if (!res.ok) redirect("/login");
  if (res.data.length === 0) {
    return <p className="text-sm text-zinc-500">{before ? "Não há pedidos mais antigos." : "Nenhum pedido ainda."}</p>;
  }
  const older = res.data.length === REQUESTS_PAGE_SIZE ? res.data[res.data.length - 1].createdAt : null;
  return (
    <>
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="px-4 py-3 font-medium">Criado</th>
            <th className="px-4 py-3 font-medium">Cliente</th>
            <th className="px-4 py-3 font-medium">Categoria</th>
            <th className="px-4 py-3 font-medium">Bairro</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Prestador</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {res.data.map((request) => (
            <tr key={request.id}>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-500">
                {dateFormat.format(new Date(request.createdAt))}
              </td>
              <td className="px-4 py-3">{request.clientName}</td>
              <td className="px-4 py-3">
                <p>{request.categoryName}</p>
                <p className="line-clamp-1 max-w-xs text-xs text-zinc-500">{request.description}</p>
              </td>
              <td className="px-4 py-3">{request.neighborhood ?? <span className="text-zinc-400">—</span>}</td>
              <td className="px-4 py-3">
                <Link href={`/requests/${request.id}`} aria-label={`Abrir pedido de ${request.clientName}`}>
                  <StatusBadge status={request.status} />
                </Link>
              </td>
              <td className="px-4 py-3">{request.provider?.name ?? <span className="text-zinc-400">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <nav className="mt-4 flex gap-4 text-sm">
      {before ? <Link href="/requests" className="underline">Voltar aos mais recentes</Link> : null}
      {older ? <Link href={`/requests?before=${encodeURIComponent(older)}`} className="underline">Ver pedidos mais antigos</Link> : null}
    </nav>
    </>
  );
}
