# 0002 — Aceite mútuo entre prestador e cliente

**Status:** aceito

## Contexto
Os dois lados querem decidir com quem vão trabalhar, com base em nota e histórico.

## Decisão
- Pedido novo avisa os prestadores aptos (modo broadcast) ou é atribuído pelo admin.
- O prestador vê a nota do cliente e aceita ou recusa. Ao aceitar, o pedido vai para `aguardando cliente`.
- O cliente vê nota e histórico do prestador e confirma ou recusa. Ao recusar, o pedido volta para `aberto` e os demais prestadores aptos são avisados de novo.
- Recusa (de qualquer lado) é registrada; aquele prestador não vê mais aquele pedido.
- Telefone e endereço completo só são revelados após a confirmação do cliente.
- Dois prestadores aceitando ao mesmo tempo: a transação trava a linha do pedido; o segundo recebe "pedido não está mais disponível".

## Consequências
- Mais um passo antes do atendimento começar; compensado por menos atendimentos ruins.
