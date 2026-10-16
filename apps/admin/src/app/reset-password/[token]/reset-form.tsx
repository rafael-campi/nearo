"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form";
import { resetPassword } from "../../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword.bind(null, token), {} as FormState);
  if (state.success) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage state={state} />
        <Link href="/login" className="text-sm underline-offset-2 hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Senha nova" name="password" type="password" autoComplete="new-password" minLength={8} required />
      <Field label="Confirme a senha" name="confirm" type="password" autoComplete="new-password" required />
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Redefinir senha</SubmitButton>
    </form>
  );
}
