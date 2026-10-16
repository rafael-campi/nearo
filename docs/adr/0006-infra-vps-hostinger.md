# 0006 — Infraestrutura: uma VPS Hostinger KVM 4 em São Paulo

**Status:** aceito

## Contexto
Meta inicial: pelo menos 200 usuários simultâneos, custo mensal baixo.

## Decisão
- VPS Hostinger KVM 4 (4 vCPU, 16 GB RAM, 200 GB NVMe), data center São Paulo.
- Docker Compose: Caddy (HTTPS), api ×2, worker, admin, Postgres + PostGIS, Redis, MinIO.
- Postgres e Redis sem porta exposta; firewall só com 22/80/443; SSH só por chave; fail2ban; atualizações automáticas de segurança.
- Backup diário (`pg_dump`) + WAL contínuo para storage externo (Cloudflare R2 ou Backblaze B2); restauração testada.
- Monitoramento: Uptime Kuma + Netdata/Grafana.

## Consequências
- Custo bem menor que serviços gerenciados; manutenção (backup, patches, monitoramento) é nossa.
- Ponto único de falha aceito na v1.
- Quando houver receita/escala, migrar o banco para serviço gerenciado é um dump/restore.
