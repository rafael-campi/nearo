# 0007 — Primeira versão sem IA

**Status:** aceito

## Decisão
A v1 não usa IA. Candidatos para versões futuras, já mapeados: triagem do pedido (texto + foto), análise de foto, sugestão de respostas no chat, moderação, relatório automático ao concluir e perguntas em linguagem natural no painel.

## Consequências
Nada na arquitetura depende de IA. Quando entrar, será um módulo no backend (chave da API só no servidor, saída estruturada, registro em `ai_runs`), sem mudar o fluxo existente.
