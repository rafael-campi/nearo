import type { EligibleProvider, RequestDecline, RequestEvent, ServiceRequest } from "@despacho/shared";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { StatusBadge } from "@/components/status-badge";
import { companyApi } from "@/lib/dal";
import { AssignButton } from "./assign-button";
import { CancelForm } from "./cancel-form";

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export default function RequestPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <section className="flex flex-col gap-8">
      <Link href="/requests" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Pedidos
      </Link>
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando pedido…</p>}>
        <Detail params={params} />
      </Suspense>
    </section>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await companyApi<ServiceRequest>(`/company/service-requests/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) redirect("/login");
  const request = res.data;
  return (
    <>
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-2 flex items-center gap-3">
          <h1 className="text-lg font-semibold">{request.categoryName}</h1>
          <StatusBadge status={request.status} />
        </div>
        <p className="text-sm">{request.description}</p>
        <p className="mt-3 text-sm text-zinc-500">
          {request.clientName} · {request.neighborhood ?? "bairro não identificado"}
          {request.addressComplement ? ` · ${request.addressComplement}` : ""} · {dateFormat.format(new Date(request.createdAt))}
        </p>
        {request.cancellation ? (
          <p className="mt-2 text-sm text-zinc-500">
            Cancelado {{ client: "pelo cliente", admin: "pela empresa", system: "pelo sistema" }[request.cancellation.byRole]}:{" "}
            {request.cancellation.reason}
          </p>
        ) : null}
        {request.provider ? (
          <p className="mt-2 text-sm">
            Prestador: <strong>{request.provider.name}</strong>
            {request.provider.phone ? ` · ${request.provider.phone}` : ""}
          </p>
        ) : null}
      </div>
      {request.status === "open" ? (
        <Suspense fallback={<p className="text-sm text-zinc-500">Carregando prestadores aptos…</p>}>
          <Eligible requestId={request.id} />
        </Suspense>
      ) : null}
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando recusas…</p>}>
        <Declines requestId={request.id} />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando histórico…</p>}>
        <Events requestId={request.id} />
      </Suspense>
      {request.status !== "completed" && request.status !== "cancelled" ? <CancelForm requestId={request.id} /> : null}
    </>
  );
}

async function Eligible({ requestId }: { requestId: string }) {
  const res = await companyApi<EligibleProvider[]>(`/company/service-requests/${requestId}/eligible-providers`);
  if (!res.ok) redirect("/login");
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Atribuir a um prestador apto</h2>
      {res.data.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum prestador apto agora.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {res.data.map((provider) => (
            <li key={provider.membershipId} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium">{provider.name}</p>
                <p className="text-sm text-zinc-500">a {provider.distanceKm.toLocaleString("pt-BR")} km do pedido</p>
              </div>
              <AssignButton requestId={requestId} provider={provider} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function Declines({ requestId }: { requestId: string }) {
  const res = await companyApi<RequestDecline[]>(`/company/service-requests/${requestId}/declines`);
  if (!res.ok) redirect("/login");
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Recusas</h2>
      {res.data.length === 0 ? (
        <p className="text-sm text-zinc-500">Ninguém recusou este pedido.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {res.data.map((decline, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="flex-1">
                {decline.by === "provider" ? `${decline.providerName} recusou o pedido` : `Cliente recusou ${decline.providerName}`}
              </span>
              <span className="tabular-nums text-zinc-500">{dateFormat.format(new Date(decline.createdAt))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function Events({ requestId }: { requestId: string }) {
  const res = await companyApi<RequestEvent[]>(`/company/service-requests/${requestId}/events`);
  if (!res.ok) redirect("/login");
  if (res.data.length === 0) return null;
  const who = { client: "O cliente", admin: "A empresa", provider: "O prestador", system: "O sistema" } as const;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Cancelamentos e desistências</h2>
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {res.data.map((event, i) => (
          <li key={i} className="px-4 py-3 text-sm">
            <p>
              {event.byName ?? who[event.byRole]} {event.kind === "cancellation" ? "cancelou o pedido" : "desistiu do pedido"}{" "}
              <span className="text-zinc-500">· {dateFormat.format(new Date(event.createdAt))}</span>
            </p>
            <p className="text-zinc-500">Motivo: {event.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
