"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form";
import { login } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="E-mail" name="email" type="email" defaultValue={state.values?.email} autoComplete="email" required />
      <Field label="Senha" name="password" type="password" autoComplete="current-password" required />
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Entrar</SubmitButton>
    </form>
  );
}
