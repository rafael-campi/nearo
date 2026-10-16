"use client";

import { ratingLabel, type Category, type Provider } from "@despacho/shared";
import { useActionState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/form";
import { setProviderActive, setProviderCategories } from "../../actions";

export function ProviderRow({ provider, categories }: { provider: Provider; categories: Category[] }) {
  const [toggling, startToggle] = useTransition();
  const [state, saveCategories, saving] = useActionState(
    setProviderCategories.bind(null, provider.membershipId),
    {} as FormState,
  );
  // Categorias desativadas só aparecem se o prestador ainda as tiver.
  const options = categories.filter((c) => c.active || provider.categoryIds.includes(c.id));

  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center gap-3">
        <div className={`flex-1 ${provider.active ? "" : "text-zinc-400"}`}>
          <p className="text-sm font-medium">{provider.name}</p>
          <p className="text-sm text-zinc-500">{provider.email}</p>
          <p className="text-sm text-zinc-500">{ratingLabel(provider.rating)}</p>
          <ProviderSettingsSummary provider={provider} />
        </div>
        {!provider.active && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Desativado</span>
        )}
        <button
          type="button"
          disabled={toggling}
          aria-label={`${provider.active ? "Desativar" : "Reativar"} ${provider.name}`}
          onClick={() => startToggle(() => setProviderActive(provider.membershipId, !provider.active))}
          className="w-20 text-right text-sm text-zinc-600 hover:text-zinc-950 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          {provider.active ? "Desativar" : "Reativar"}
        </button>
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-zinc-500">Cadastre categorias para atribuir a este prestador.</p>
      ) : (
        <form action={saveCategories} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <fieldset className="contents">
            <legend className="sr-only">Categorias de {provider.name}</legend>
            {options.map((category) => (
              <label key={category.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="categoryId"
                  value={category.id}
                  defaultChecked={provider.categoryIds.includes(category.id)}
                  className="size-4 accent-zinc-900"
                />
                <span className={category.active ? "" : "text-zinc-400"}>{category.name}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            disabled={saving}
            aria-label={`Salvar categorias de ${provider.name}`}
            className="text-sm font-medium text-zinc-900 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-100"
          >
            Salvar categorias
          </button>
          <FormMessage state={state} />
        </form>
      )}
    </li>
  );
}

function ProviderSettingsSummary({ provider }: { provider: Provider }) {
  const base = provider.baseLocation;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
      <span className={provider.available ? "font-medium text-emerald-600" : ""}>
        {provider.available ? "Disponível" : "Indisponível"}
      </span>
      <span aria-hidden>·</span>
      {base ? (
        <>
          <span>Atende até {provider.serviceRadiusKm} km de</span>
          <a
            href={`https://www.openstreetmap.org/?mlat=${base.latitude}&mlon=${base.longitude}#map=15/${base.latitude}/${base.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            endereço-base
          </a>
        </>
      ) : (
        <span>Sem endereço-base (não recebe pedidos)</span>
      )}
    </p>
  );
}
