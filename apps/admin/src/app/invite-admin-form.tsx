"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form";
import { inviteAdmin } from "./actions";

export function InviteAdminForm() {
  const [state, action, pending] = useActionState(inviteAdmin, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="E-mail do novo admin" name="email" type="email" defaultValue={state.values?.email} required />
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Enviar convite</SubmitButton>
    </form>
  );
}
