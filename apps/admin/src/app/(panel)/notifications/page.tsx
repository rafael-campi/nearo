import type { Notification } from "@despacho/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { companyApi } from "@/lib/dal";
import { MarkRead } from "./mark-read";

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export default function NotificationsPage() {
  return (
    <section>
      <h1 className="mb-1 text-lg font-semibold">Atualizações</h1>
      <p className="mb-6 text-sm text-zinc-500">Avisos de pedidos que precisam de você.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Carregando…</p>}>
        <List />
      </Suspense>
    </section>
  );
}

async function List() {
  const res = await companyApi<Notification[]>("/my/notifications");
  if (!res.ok) redirect("/login");
  if (res.data.length === 0) return <p className="text-sm text-zinc-500">Nenhuma atualização ainda.</p>;
  const unread = res.data.some((n) => n.readAt === null);
  return (
    <div className="flex flex-col gap-3">
      {unread ? <MarkRead /> : null}
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {res.data.map((n) => (
          <li key={n.id} className={`px-4 py-3 ${n.readAt === null ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
            <p className="text-sm font-medium">
              {n.serviceRequestId ? <Link href={`/requests/${n.serviceRequestId}`} className="underline-offset-2 hover:underline">{n.title}</Link> : n.title}
            </p>
            <p className="text-sm text-zinc-500">{n.body}</p>
            <p className="text-xs text-zinc-400">
              {n.companyName} · {dateFormat.format(new Date(n.createdAt))}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
