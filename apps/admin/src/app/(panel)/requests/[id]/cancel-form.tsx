"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form";
import { cancelRequest } from "../../../actions";

export function CancelForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(cancelRequest.bind(null, requestId), {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">Cancelar pedido</h2>
      <Field label="Motivo" name="reason" defaultValue={state.values?.reason} required minLength={3} maxLength={500} />
      <FormMessage state={state} />
      <div>
        <SubmitButton pending={pending}>Cancelar pedido</SubmitButton>
      </div>
    </form>
  );
}
