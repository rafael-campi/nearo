import { Card } from "@/components/form";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Despacho</h1>
        <p className="mb-6 text-sm text-zinc-500">Entre no painel da sua empresa.</p>
        <LoginForm />
      </Card>
    </main>
  );
}
