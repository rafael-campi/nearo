import { Suspense } from "react";
import { Card } from "@/components/form";
import { ResetForm } from "./reset-form";

export default function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Criar senha nova</h1>
        <p className="mb-6 text-sm text-zinc-500">Escolha a senha que você vai usar para entrar.</p>
        <Suspense fallback={<p className="text-sm text-zinc-500">Carregando…</p>}>
          <Form params={params} />
        </Suspense>
      </Card>
    </main>
  );
}

async function Form({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ResetForm token={token} />;
}
