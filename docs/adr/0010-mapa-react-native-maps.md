# 0010 — Mapa com react-native-maps e endereço por pino

**Status:** aceito

O app usa `react-native-maps` (Google Maps no Android, Apple Maps no iOS; SDK mobile sem custo, exige chave do Google). O cliente informa o endereço do pedido marcando um pino no mapa, mais um complemento em texto livre; o servidor faz uma geocodificação reversa por pedido só para obter o bairro. Assim temos coordenadas exatas para a área de atendimento e o raio de aviso sem pagar geocodificação de endereço digitado.

## Alternativas consideradas
- MapLibre + tiles OpenStreetMap: sem Google, mas exige contratar ou hospedar um provedor de tiles.
- Endereço digitado com geocodificação: mais familiar para o cliente, mas custo por chamada e coordenadas menos confiáveis.
