import { InviteAdminForm } from "./invite-admin-form";

export default function AdminsPage() {
  return (
    <section className="max-w-sm">
      <h1 className="mb-1 text-lg font-semibold">Administradores</h1>
      <p className="mb-4 text-sm text-zinc-500">Convide outra pessoa para administrar a empresa.</p>
      <InviteAdminForm />
    </section>
  );
}
