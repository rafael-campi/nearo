# 0009 — Arquivos no Cloudflare R2 em vez de MinIO

**Status:** aceito. Substitui a parte de MinIO dos ADRs 0003 e 0006.

A MinIO parou de publicar imagens Docker oficiais, e manter um storage na VPS é mais um serviço para operar e fazer backup. Fotos do pedido e do chat vão para o Cloudflare R2 (compatível com S3, sem cobrança de saída), um bucket por ambiente (`dev`, `prod`). O app continua enviando direto por URL assinada gerada pela API, como no ADR 0005.

## Alternativas consideradas
- Garage ou SeaweedFS na VPS: sem custo, mas mais operação e backup por nossa conta.
- MinIO por imagem não oficial ou compilado: risco de manutenção e de cadeia de suprimentos.
