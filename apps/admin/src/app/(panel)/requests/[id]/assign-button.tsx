"use client";

import type { EligibleProvider } from "@despacho/shared";
import { useState, useTransition } from "react";
import { assignRequest } from "../../../actions";

export function AssignButton({ requestId, provider }: { requestId: string; provider: EligibleProvider }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        aria-label={`Atribuir a ${provider.name}`}
        onClick={() =>
          start(async () => {
            const res = await assignRequest(requestId, provider.membershipId);
            setError(res.success ? null : (res.message ?? "Erro"));
          })
        }
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Atribuir
      </button>
    </>
  );
}
