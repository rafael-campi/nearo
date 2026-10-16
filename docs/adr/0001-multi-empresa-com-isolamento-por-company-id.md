# 0001 — Multi-empresa com isolamento por company_id

**Status:** aceito

## Contexto
Várias empresas usam a mesma plataforma, cada uma com seus próprios prestadores, categorias e pedidos. O cliente escolhe quais empresas o atendem. Vazamento de dados entre empresas é inaceitável.

## Decisão
- Banco único, schema único. Toda tabela de domínio tem `company_id`.
- Papel do usuário fica no vínculo (`membership`), não no usuário: a mesma pessoa pode ter vínculos com várias empresas.
- Duas travas: filtro por `company_id` na camada de repositório da API **e** Row Level Security no Postgres, alimentada por `set local app.user_id` / `app.company_id` em cada transação.
- Empresa desativada derruba o acesso de todos os seus vínculos.

## Consequências
- Um bug no código não vaza dados entre empresas (o RLS bloqueia).
- Toda nova tabela precisa de `company_id`, policy de RLS e teste de isolamento.
