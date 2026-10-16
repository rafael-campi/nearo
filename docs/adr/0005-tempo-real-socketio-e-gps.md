# 0005 — Tempo real: Socket.IO, chat, GPS e aviso de proximidade

**Status:** aceito

## Decisão
- Um socket por app aberto. Salas por pedido (`pedido:{id}`) e por usuário (`user:{id}`).
- **Chat:** a API valida que o remetente é cliente ou prestador do pedido, grava no Postgres, emite na sala e, se o destinatário estiver offline, enfileira push. Cada mensagem tem `client_id` gerado no app para evitar duplicação em reenvio. Fotos vão direto para o storage por URL assinada; a mensagem guarda só o caminho.
- **GPS:** enviado pelo prestador a cada ~10 s **só enquanto o pedido está "a caminho"**. A última posição fica no Redis e é emitida para o cliente; a API calcula a distância (PostGIS) e, ao entrar no raio de 500 m, grava uma notificação para o cliente **uma única vez** por pedido.
- Status do pedido e notificações também são emitidos pelo socket; push cobre o app fechado.

## Consequências
- Várias instâncias da API funcionam graças ao adapter Redis.
- A posição do prestador deixa de ser exposta assim que ele chega.
