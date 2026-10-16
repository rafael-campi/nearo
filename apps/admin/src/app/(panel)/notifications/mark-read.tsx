"use client";

import { useTransition } from "react";
import { markNotificationsRead } from "../../actions";

export function MarkRead() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => markNotificationsRead())}
      className="self-start text-sm text-zinc-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-400"
    >
      Marcar como lidas
    </button>
  );
}
