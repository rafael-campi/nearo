"use client";

import type { AssignmentMode } from "@despacho/shared";
import { useActionState } from "react";
import { FormMessage, SubmitButton, type FormState } from "@/components/form";
import { setAssignmentMode } from "../../actions";

const options: { value: AssignmentMode; title: string; description: string }[] = [
  {
    value: "broadcast",
    title: "Broadcast",
    description: "Todo pedido novo avisa os prestadores aptos; o primeiro a aceitar é apresentado ao cliente.",
  },
  {
    value: "manual",
    title: "Manual",
    description: "Você é avisado de cada pedido novo e escolhe o prestador. Os prestadores só veem o que você atribuir.",
  },
];

export function ModeForm({ mode }: { mode: AssignmentMode }) {
  const [state, action, pending] = useActionState(setAssignmentMode, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Modo de atribuição</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer gap-3 rounded-xl border border-zinc-200 bg-white p-4 has-[:checked]:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:has-[:checked]:border-zinc-300"
          >
            <input type="radio" name="assignmentMode" value={option.value} defaultChecked={option.value === mode} className="mt-1" />
            <span>
              <span className="block text-sm font-medium">{option.title}</span>
              <span className="block text-sm text-zinc-500">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-zinc-500">
        O modo vale para pedidos novos e para os que voltarem a ficar abertos. Em qualquer modo você pode atribuir um pedido aberto.
      </p>
      <FormMessage state={state} />
      <div>
        <SubmitButton pending={pending}>Salvar</SubmitButton>
      </div>
    </form>
  );
}
