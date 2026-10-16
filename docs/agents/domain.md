# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**. Its glossary is **`GLOSSARY.md`** (not `CONTEXT.md`). Wherever a skill says `CONTEXT.md`, read and write `GLOSSARY.md` instead. Never create a parallel `CONTEXT.md`.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: domain terms.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.
- **`docs/v1-scope.md`**: what is in and out of the first version. Don't propose work outside it without saying so.
- **`docs/reference/`** (when relevant): reference SQL schema and the navigable prototype (`despacho.html`). They show expected behavior; don't copy them as code.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) updates them when terms or decisions actually get resolved.

## File structure

```
/
├── CLAUDE.md
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   │   ├── 0001-multi-empresa-com-isolamento-por-company-id.md
│   │   └── ...
│   ├── reference/
│   └── v1-scope.md
├── apps/        (api, admin, mobile)
└── packages/    (shared)
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`, which adds it to `GLOSSARY.md`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (v1 sem IA), but worth reopening because…_
