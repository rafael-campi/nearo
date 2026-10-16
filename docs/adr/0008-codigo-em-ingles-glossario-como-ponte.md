# 0008 — Código em inglês, glossário em português como ponte

**Status:** aceito

## Decisão
Todo identificador que nós nomeamos (tabelas, colunas, enums, tipos, schemas Zod, rotas, eventos de socket, nomes de arquivo) fica em inglês, usando exatamente o nome da coluna "No código" do `GLOSSARY.md`. Conversa, docs, ADRs, tickets e textos da interface ficam em português. Exemplos: Pedido → `service_requests` / `ServiceRequest`, Prestador → `provider`, status A caminho → `en_route`, isolamento por `company_id` com `app.user_id` / `app.company_id` (ADR 0001).

## Alternativas consideradas
- Domínio em português no código (`pedidos`, `empresa_id`, `PedidoService`): mais perto da conversa, mas mistura inevitável com a API das bibliotecas (`pedidoRepository.findMany`), acentos removidos e mais atrito com o ecossistema.

## Consequências
- O schema de referência (`docs/reference/`) é híbrido (colunas e enums em português, como `aceito_em` e `solicitante`); ao portar, renomeie seguindo o glossário em vez de copiar os nomes.
- Termo novo do domínio entra primeiro no glossário, com o nome em inglês, antes de aparecer no código.
