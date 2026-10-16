"use client";

import type { Category } from "@despacho/shared";
import { useActionState, useTransition } from "react";
import { FormMessage, SubmitButton, type FormState } from "@/components/form";
import { createCategory, renameCategory, setCategoryActive } from "../../actions";

const inputClass =
  "min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300";

export function CreateCategoryForm() {
  const [state, action, pending] = useActionState(createCategory, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          name="name"
          aria-label="Nova categoria"
          placeholder="Ex.: Elétrica"
          defaultValue={state.values?.name}
          required
          className={inputClass}
        />
        <SubmitButton pending={pending}>Adicionar</SubmitButton>
      </div>
      {!state.success && <FormMessage state={state} />}
    </form>
  );
}

export function CategoryRow({ category }: { category: Category }) {
  const [state, rename, renaming] = useActionState(renameCategory.bind(null, category.id), {} as FormState);
  const [toggling, startToggle] = useTransition();

  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-3">
        <form action={rename} className="flex flex-1 items-center gap-2">
          <input
            name="name"
            aria-label={`Nome da categoria ${category.name}`}
            defaultValue={state.values?.name ?? category.name}
            required
            className={`${inputClass} ${category.active ? "" : "text-zinc-400"}`}
          />
          <button
            type="submit"
            disabled={renaming}
            className="text-sm text-zinc-600 hover:text-zinc-950 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Salvar
          </button>
        </form>
        {!category.active && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Desativada</span>
        )}
        <button
          type="button"
          disabled={toggling}
          onClick={() => startToggle(() => setCategoryActive(category.id, !category.active))}
          className="w-20 text-right text-sm text-zinc-600 hover:text-zinc-950 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          {category.active ? "Desativar" : "Reativar"}
        </button>
      </div>
      {!state.success && <FormMessage state={state} />}
    </li>
  );
}
