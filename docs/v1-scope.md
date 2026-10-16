# Escopo da v1

## Entra

**Empresa (web admin)**
- Cadastrar prestadores por convite, definir categorias, desativar/reativar.
- Ver todos os pedidos da empresa, atribuir manualmente, ver recusas.
- Ver notas dos prestadores.

**Cliente (app)**
- Cadastro próprio; escolher quais empresas o atendem.
- Criar pedido (empresa, categoria, descrição, endereço, fotos).
- Confirmar ou recusar o prestador que aceitou (vendo nota e histórico).
- Chat com texto e fotos; mapa ao vivo do prestador a caminho; aviso quando ele entra no raio de 500 m.
- Cancelar antes da confirmação; avaliar o prestador ao concluir.

**Prestador (app)**
- Entrar por convite; ligar/desligar disponibilidade.
- Receber push de pedidos novos nas suas categorias; ver nota do cliente; aceitar ou recusar.
- Avançar status: a caminho → chegou → em execução → concluído (GPS enviado só enquanto a caminho).
- Chat; avaliar o cliente ao concluir.

**Plataforma**
- Multi-empresa com isolamento por `company_id` + RLS.
- Push via FCM; tempo real via Socket.IO.
- Deploy em uma VPS (Hostinger KVM 4, São Paulo) com backup externo.

## Não entra na v1

- IA (triagem, análise de foto, relatórios) — ADR 0007.
- Pagamento dentro do app, split, comissão.
- Orçamento/proposta com preço pelo prestador.
- Agendamento com data/hora futura (v1 é atendimento sob demanda).
- Painel do dono da plataforma (gestão de empresas e planos é manual na v1).
- Live Activities / widget de tela de bloqueio.

## Regras do pedido

Decididas na sessão de 2026-10-15. Termos conforme `GLOSSARY.md`.

**Criação e atribuição**
- O modo de atribuição da empresa só define o que acontece na criação. Em qualquer modo, o admin pode atribuir um pedido `open`.
- Broadcast sem aceite em 15 min: o admin é notificado; o pedido continua `open` e o cliente vê "procurando prestador". Sem cancelamento automático.
- Sempre que um pedido volta para `open`: no broadcast, os prestadores aptos são avisados de novo; no manual, o admin é notificado.

**Aceite mútuo**
- Antes de aceitar, o prestador vê categoria, descrição, fotos, bairro, distância aproximada do seu endereço-base, primeiro nome do cliente, nota dele na empresa e número de pedidos concluídos. Endereço completo, telefone e chat só após `confirmed`.
- `awaiting_client` sem resposta em 10 min: volta para `open`, sem contar como recusa. Push ao cliente no aceite e de novo aos 5 min.
- Prestador tem no máximo um pedido ativo (`confirmed` a `in_progress`); com um ativo, não é apto. Cliente pode ter vários pedidos abertos.

**Endereço**
- Cliente marca um pino no mapa (começa na localização atual) e escreve um complemento livre. O bairro vem de geocodificação reversa no servidor, uma vez por pedido.

**Cancelamento e desistência**
- Cliente cancela até `en_route`; depois de `arrived`, só o admin. Admin cancela qualquer pedido não `completed`.
- Prestador pode desistir até `arrived`: o pedido volta para `open` e conta como recusa dele.
- Todo cancelamento e desistência guarda quem fez e o motivo (texto livre).
- Admin desativa prestador com pedido ativo: o pedido volta para `open` (desistência "desativado pelo admin") e o cliente é avisado.
- Empresa desativada: pedidos não concluídos viram `cancelled` com motivo "empresa desativada".

**Chat e avaliação**
- Chat abre em `confirmed`; fica só leitura em `completed` e `cancelled`. Admin lê o chat de qualquer pedido da empresa, sem escrever.
- Avaliação opcional, até 7 dias após `completed`, às cegas (visível quando os dois avaliam ou o prazo acaba). A nota só conta avaliações visíveis e é por empresa.

**Entrada e conta**
- Login por e-mail e senha, com recuperação por e-mail.
- Cliente entra numa empresa pelo código de acesso dela; prestador, por convite. A empresa pode desativar qualquer vínculo.

**Prestador**
- O admin define as categorias do prestador; o prestador define no app o endereço-base e o raio da área de atendimento. Sem endereço-base, não é apto (o app pede no primeiro acesso). O admin vê ambos no painel.
- Prestador em várias empresas: disponível, endereço-base, categorias e área de atendimento valem por empresa; o limite de um pedido ativo vale no total (a API só responde sim/não, sem expor dados de outra empresa).
- Quem criou o pedido nunca é prestador apto para ele, nem pode ser atribuído a ele.

**Fotos**
- Até 5 fotos no pedido (na criação) e uma por mensagem no chat, redimensionadas no app (máx. 1000 px, JPEG ~80%). Retenção enquanto o pedido existir.

**Empresas e contas**
- Empresa e primeiro admin são criados por script na API (`company:create`), que envia convite de admin. Não existe usuário "dono da plataforma" no banco.
- Exclusão de conta no app, só sem pedido ativo ou aberto: apaga dados pessoais e desativa vínculos; pedidos, mensagens e avaliações ficam com autor "Usuário removido".
