"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form";
import { acceptInvite } from "../../actions";

export function AcceptForm({ token, hasAccount }: { token: string; hasAccount: boolean }) {
  const [state, action, pending] = useActionState(acceptInvite.bind(null, token), {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      {hasAccount ? (
        <Field label="Sua senha atual" name="password" type="password" autoComplete="current-password" required />
      ) : (
        <>
          <Field label="Seu nome" name="name" autoComplete="name" defaultValue={state.values?.name} required />
          <Field label="Senha" name="password" type="password" autoComplete="new-password" minLength={8} required />
          <Field label="Confirme a senha" name="confirm" type="password" autoComplete="new-password" required />
        </>
      )}
      <FormMessage state={state} />
      <SubmitButton pending={pending}>{hasAccount ? "Entrar e aceitar" : "Criar conta e aceitar"}</SubmitButton>
    </form>
  );
}
