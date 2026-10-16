import Link from "next/link";
import { Card } from "@/components/form";
import { ForgotForm } from "./forgot-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Esqueci minha senha</h1>
        <p className="mb-6 text-sm text-zinc-500">Informe seu e-mail e enviaremos um link para criar uma senha nova.</p>
        <ForgotForm />
        <Link href="/login" className="mt-4 block text-center text-sm text-zinc-500 underline-offset-2 hover:underline">
          Voltar para o login
        </Link>
      </Card>
    </main>
  );
}
