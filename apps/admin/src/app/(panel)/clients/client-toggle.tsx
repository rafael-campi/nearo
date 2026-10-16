"use client";

import type { Client } from "@despacho/shared";
import { useTransition } from "react";
import { setClientActive } from "../../actions";

export function ClientToggle({ client }: { client: Client }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`${client.active ? "Desativar" : "Reativar"} ${client.name}`}
      onClick={() => start(() => setClientActive(client.membershipId, !client.active))}
      className="w-20 text-right text-sm text-zinc-600 hover:text-zinc-950 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50"
    >
      {client.active ? "Desativar" : "Reativar"}
    </button>
  );
}
