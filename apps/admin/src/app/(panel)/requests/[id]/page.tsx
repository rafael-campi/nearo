import { ratingLabel, type EligibleProvider, type MessagePage, type RequestDecline, type RequestEvent, type RequestReviews, type ServiceRequest } from "@despacho/shared";
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
        {request.photos.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Fotos do pedido">
            {request.photos.map((url, i) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  {/* Links assinados do storage (válidos por 1 h): sem otimização do next/image. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Foto ${i + 1} do pedido`} className="h-24 w-24 rounded-lg object-cover" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {request.cancellation ? (
          <p className="mt-2 text-sm text-zinc-500">
            Cancelado {{ client: "pelo cliente", admin: "pela empresa", system: "pelo sistema" }[request.cancellation.byRole]}:{" "}
            {request.cancellation.reason}
          </p>
        ) : null}
        {request.provider ? (
          <p className="mt-2 text-sm">
            Prestador: <strong>{request.provider.name}</strong> · {ratingLabel(request.provider.rating)}
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
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando conversa…</p>}>
        <Chat requestId={request.id} />
      </Suspense>
      {request.status === "completed" ? (
        <Suspense fallback={<p className="text-sm text-zinc-500">Carregando avaliações…</p>}>
          <Reviews requestId={request.id} />
        </Suspense>
      ) : null}
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

/** Conversa do pedido, só leitura: o admin lê o chat de qualquer pedido da empresa, sem escrever. */
async function Chat({ requestId }: { requestId: string }) {
  const res = await companyApi<MessagePage>(`/company/service-requests/${requestId}/messages`);
  if (!res.ok) redirect("/login");
  if (res.data.messages.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Conversa</h2>
      <ul className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {res.data.nextCursor ? <li className="text-xs text-zinc-400">Mostrando as mensagens mais recentes.</li> : null}
        {res.data.messages.map((message) => (
          <li key={message.id} className="text-sm">
            <span className="font-medium">{message.senderName}</span>{" "}
            <span className="text-xs text-zinc-400">{dateFormat.format(new Date(message.createdAt))}</span>
            {message.photoUrl ? (
              <a href={message.photoUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={message.photoUrl} alt="Foto da mensagem" className="my-1 h-32 w-32 rounded-lg object-cover" />
              </a>
            ) : null}
            <p className="whitespace-pre-wrap">{message.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Avaliações já reveladas (às cegas até os dois avaliarem ou o prazo de 7 dias acabar). */
async function Reviews({ requestId }: { requestId: string }) {
  const res = await companyApi<RequestReviews>(`/company/service-requests/${requestId}/reviews`);
  if (!res.ok) redirect("/login");
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Avaliações</h2>
      {res.data.reviews.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nenhuma avaliação visível ainda. Elas aparecem quando os dois avaliam ou em{" "}
          {res.data.deadline ? dateFormat.format(new Date(res.data.deadline)) : "7 dias"}.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {res.data.reviews.map((review) => (
            <li key={review.id} className="px-4 py-3 text-sm">
              <p>
                <strong>{review.reviewerName ?? "Usuário removido"}</strong> ({review.reviewerRole === "client" ? "cliente" : "prestador"}){" "}
                avaliou com <strong>{review.rating}</strong>/5
              </p>
              {review.comment ? <p className="text-zinc-500">{review.comment}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
