# Glossário

Conversa, docs, tickets e interface usam os termos em português. Todo identificador no código
(tabelas, colunas, enums, tipos, schemas Zod, rotas, eventos de socket) usa o nome em inglês da
coluna "No código". Este glossário é a ponte entre os dois (ADR 0008).

| Termo | No código | Definição |
|---|---|---|
| Empresa | `company` | Tenant. Tem seus próprios usuários, categorias, prestadores e pedidos. |
| Modo de atribuição | `assignment_mode` | Configuração da empresa (`manual` ou `broadcast`) que define o que acontece quando um pedido é criado. |
| Admin | `admin` | Usuário da empresa que cadastra/desativa prestadores, vê todos os pedidos e atribui manualmente. |
| Prestador | `provider` | Pessoa cadastrada pela empresa que executa serviços. Atende uma ou mais categorias, dentro da sua área de atendimento. |
| Endereço-base | `base_location` | Ponto fixo de onde o prestador parte em uma empresa (vale por empresa), usado para a área de atendimento e a distância mostrada nos pedidos. |
| Área de atendimento | `service_area` | Círculo em volta do endereço-base do prestador, com raio definido por ele (padrão 20 km). _Evitar:_ raio (reservado para o raio de aviso). |
| Cliente | `client` | Pessoa que se cadastra sozinha no app e entra em empresas pelo código de acesso de cada uma. _Evitar:_ solicitante. |
| Código de acesso | `join_code` | Código ou link que a empresa divulga para clientes entrarem nela. Diferente do convite, que é para prestadores. |
| Vínculo | `membership` | Relação usuário ↔ empresa com um papel. Uma pessoa pode ter vínculos com várias empresas. A empresa pode desativar um vínculo. |
| Convite | `invite` | Forma de um prestador entrar: a empresa convida, a pessoa aceita. _Evitar:_ usar para clientes (ver código de acesso). |
| Categoria | `category` | Tipo de serviço de uma empresa (Elétrica, Hidráulica…). |
| Pedido | `service_request` | Solicitação de serviço feita por um cliente para uma empresa, em uma categoria. _Evitar:_ chamado, ordem de serviço. |
| Pedido ativo | `active_request` | Pedido de um prestador entre confirmado e em execução. Um prestador tem no máximo um. |
| Disponível | `available` | Prestador que aceita receber avisos de pedidos novos agora, em uma empresa. Vale por empresa. |
| Aceite mútuo | `mutual_acceptance` | O prestador aceita o pedido e, depois, o cliente confirma o prestador. Os dois podem recusar. |
| Recusa | `decline` | Prestador recusa um pedido, ou cliente recusa um prestador. Quem foi recusado deixa de ver aquele pedido. |
| Desistência | `withdrawal` | Prestador confirmado abandona o pedido antes de chegar. O pedido volta para aberto e conta como recusa dele. |
| Cancelamento | `cancellation` | Encerramento do pedido sem conclusão, por cliente (até a caminho) ou admin (antes de concluído). Guarda quem e o motivo. |
| Atribuição | `assignment` | Admin escolhe o prestador de um pedido `open` manualmente, em qualquer modo de atribuição. |
| Broadcast | `broadcast` | Modo em que um pedido novo avisa todos os prestadores aptos e o primeiro a aceitar é apresentado ao cliente. |
| Prestador apto | `eligible_provider` | Ativo, disponível, sem pedido ativo, atende a categoria, com o endereço do pedido dentro da sua área de atendimento e sem recusa para aquele pedido. |
| Raio de aviso | `proximity_radius` | Distância (padrão 500 m) em que o cliente é avisado de que o prestador está chegando. Disparado uma vez por pedido. |
| Avaliação | `review` | Nota 1–5 + comentário que cliente e prestador dão um ao outro após o pedido concluído. Opcional e às cegas: só fica visível quando os dois avaliam ou o prazo acaba. |
| Nota | `rating` | Média das avaliações visíveis recebidas por uma pessoa **dentro de uma empresa**. Nunca atravessa empresas. |
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
| Cancelado | `cancelled` | Cliente cancelou até a caminho, ou admin cancelou antes de concluído. |

## Fora da v1

| Termo | No código | Definição |
|---|---|---|
| Gestor | `manager` | Acompanha e atribui pedidos, sem gerenciar usuários. |
