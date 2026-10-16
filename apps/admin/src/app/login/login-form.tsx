"use client";

import Link from "next/link";
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
      <Link href="/forgot-password" className="text-center text-sm text-zinc-500 underline-offset-2 hover:underline">
        Esqueci minha senha
      </Link>
    </form>
  );
}
