# 0004 — App em React Native com Expo

**Status:** aceito

## Contexto
O app precisa de chat, mapa ao vivo, GPS em segundo plano, push e câmera, e precisa ser fluido em Android de entrada.

## Decisão
React Native com Expo (nova arquitetura + Hermes), um app com modo cliente e modo prestador. Bibliotecas e práticas obrigatórias estão no `CLAUDE.md` (FlashList, Reanimated, expo-image, Zustand, TanStack Query, MMKV).

Se um módulo específico não atingir a qualidade necessária (ex.: localização em segundo plano), ele é escrito em Kotlin/Swift via Expo Modules, sem reescrever o app.

## Alternativas consideradas
- Flutter: fluidez excelente e consistente, mas Dart e nada compartilhado com admin/backend.
- Nativo (Kotlin + Swift): melhor desempenho e acesso ao sistema, mas ~2× o esforço com dois apps.

## Consequências
- React compartilhado com o painel; tipos compartilhados com o backend.
- Desempenho medido em build de release num Android de entrada desde o início.
