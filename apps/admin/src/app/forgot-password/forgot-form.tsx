"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form";
import { forgotPassword } from "../actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPassword, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="E-mail" name="email" type="email" defaultValue={state.values?.email} autoComplete="email" required />
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Enviar link</SubmitButton>
    </form>
  );
}
