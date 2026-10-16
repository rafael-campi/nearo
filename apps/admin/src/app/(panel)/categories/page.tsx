import type { Category } from "@despacho/shared";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { companyApi } from "@/lib/dal";
import { CategoryRow, CreateCategoryForm } from "./category-forms";

export default function CategoriesPage() {
  return (
    <section>
      <h1 className="mb-1 text-lg font-semibold">Categorias</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Tipos de serviço que a empresa atende. Categorias desativadas deixam de aparecer para pedidos novos.
      </p>
      <CreateCategoryForm />
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Carregando categorias…</p>}>
        <CategoryList />
      </Suspense>
    </section>
  );
}

async function CategoryList() {
  const res = await companyApi<Category[]>("/company/categories");
  if (!res.ok) redirect("/login");
  if (res.data.length === 0) {
    return <p className="mt-6 text-sm text-zinc-500">Nenhuma categoria ainda.</p>;
  }
  return (
    <ul className="mt-6 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
      {res.data.map((category) => (
        <CategoryRow key={category.id} category={category} />
      ))}
    </ul>
  );
}
