# Glossário

Conversa, docs, tickets e interface usam os termos em português. Todo identificador no código
(tabelas, colunas, enums, tipos, schemas Zod, rotas, eventos de socket) usa o nome em inglês da
coluna "No código". Este glossário é a ponte entre os dois (ADR 0008).

| Termo | No código | Definição |
|---|---|---|
| Empresa | `company` | Tenant. Tem seus próprios usuários, categorias, prestadores e pedidos. |
| Admin | `admin` | Usuário da empresa que cadastra/desativa prestadores, vê todos os pedidos e atribui manualmente. |
| Gestor | `manager` | Opcional na v1. Acompanha e atribui pedidos, sem gerenciar usuários. |
| Prestador | `provider` | Pessoa cadastrada pela empresa que executa serviços. Atende uma ou mais categorias, dentro de um raio. |
| Cliente (solicitante) | `client` | Pessoa que se cadastra sozinha no app e escolhe quais empresas a atendem. |
| Vínculo | `membership` | Relação usuário ↔ empresa com um papel. Uma pessoa pode ter vínculos com várias empresas. |
| Convite | `invite` | Forma de um prestador entrar: a empresa convida, a pessoa aceita. |
| Categoria | `category` | Tipo de serviço de uma empresa (Elétrica, Hidráulica…). |
| Pedido | `service_request` | Solicitação de serviço feita por um cliente para uma empresa, em uma categoria. _Evitar:_ chamado, ordem de serviço. |
| Disponível | `available` | Prestador que aceita receber avisos de pedidos novos agora. |
| Aceite mútuo | `mutual_acceptance` | O prestador aceita o pedido e, depois, o cliente confirma o prestador. Os dois podem recusar. |
| Recusa | `decline` | Prestador recusa um pedido, ou cliente recusa um prestador. Quem foi recusado deixa de ver aquele pedido. |
| Atribuição | `assignment` | Admin escolhe o prestador de um pedido manualmente. |
| Broadcast | `broadcast` | Modo em que um pedido novo avisa todos os prestadores aptos e o primeiro a aceitar é apresentado ao cliente. |
| Prestador apto | `eligible_provider` | Ativo, disponível, atende a categoria, dentro do raio e sem recusa para aquele pedido. |
| Raio de aviso | `proximity_radius` | Distância (padrão 500 m) em que o cliente é avisado de que o prestador está chegando. Disparado uma vez por pedido. |
| Avaliação | `review` | Nota 1–5 + comentário que cliente e prestador dão um ao outro após o pedido concluído. |
| Atualização (notificação) | `notification` | Aviso gravado para um usuário; o worker transforma em push. |

## Status do pedido

| Status | No código | Significado |
|---|---|---|
| Aberto | `open` | Sem prestador. Visível para prestadores aptos (broadcast) e para o admin. |
| Atribuído | `assigned` | Admin escolheu um prestador; aguarda o prestador aceitar. |
| Aguardando cliente | `awaiting_client` | Prestador aceitou; aguarda o cliente confirmar ou recusar. |
| Confirmado | `confirmed` | Cliente confirmou o prestador. Chat e contatos liberados. |
| A caminho | `en_route` | Prestador saiu. GPS ao vivo para o cliente. |
| Chegou | `arrived` | Prestador no endereço. |
| Em execução | `in_progress` | Serviço sendo feito. |
| Concluído | `completed` | Serviço terminado. Avaliações liberadas. |
| Cancelado | `cancelled` | Cliente cancelou antes da confirmação, ou admin cancelou. |
