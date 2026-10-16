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
