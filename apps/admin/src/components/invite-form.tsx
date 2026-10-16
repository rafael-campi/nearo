"use client";

import { useActionState } from "react";
import { invite } from "@/app/actions";
import { Field, FormMessage, SubmitButton, type FormState } from "./form";

export function InviteForm({ role, label }: { role: "admin" | "provider"; label: string }) {
  const [state, action, pending] = useActionState(invite.bind(null, role), {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={label} name="email" type="email" defaultValue={state.values?.email} required />
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Enviar convite</SubmitButton>
    </form>
  );
}
