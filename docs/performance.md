# Desempenho no Android de entrada

Meta (CLAUDE.md), **medida em build de release** num Android de entrada:

- abrir em **menos de 2 s** (abertura a frio, até a primeira tela desenhada);
- listas a **60 fps** (quase nenhum quadro acima de 16,6 ms): pedidos abertos, atualizações e chat.

> **Status: medição no aparelho pendente.** Não há aparelho nem Android SDK no ambiente onde o código foi escrito,
> então os números abaixo (tabela "Resultados") ainda estão vazios. O que foi possível fazer sem aparelho está em
> "O que já foi verificado"; o passo a passo para medir está logo depois. O ticket só fecha com a tabela preenchida.

## Aparelho de teste

Use um aparelho que represente o público (prestadores com Android de entrada), por exemplo: 2–3 GB de RAM,
Android 10–12, SoC de entrada (classe Helio G35 / Snapdragon 4xx–6xx), sem modo desempenho. Anote modelo, versão
do Android e RAM (o script de abertura imprime isso). Meça com o aparelho carregado ou na tomada e com a tela
desbloqueada, depois de reiniciar, para não herdar cache de outros apps.

## Como gerar o build de release

O app usa Hermes e a nova arquitetura (padrão do SDK) e o plugin `expo-build-properties` liga R8 e a redução de
recursos no release. O identificador do app (`com.despacho.app`) é provisório: troque em `apps/mobile/app.json`
antes de publicar.

```bash
cd apps/mobile
# Aponte para a API acessível pelo aparelho (IP da máquina na rede ou um ambiente de teste).
echo 'EXPO_PUBLIC_API_URL=http://192.168.1.7:3000' > .env
GOOGLE_MAPS_ANDROID_API_KEY=<chave> npx expo run:android --variant release --device
```

(Alternativa: `eas build --profile preview --platform android` e instalar o APK.) Faça login uma vez e feche o
app antes de medir: a abertura medida é a de uma sessão já existente, que é o uso normal.

## Como medir

Precisa do `adb` (Android platform-tools) e do aparelho com depuração USB. Rode da raiz do repositório.

**Abertura a frio** — 10 rodadas de `am start -W`, com mediana (meta: < 2000 ms):

```bash
scripts/perf/android-startup.sh 10 com.despacho.app
```

**Fluidez das listas** — zera as estatísticas de quadros, você rola a lista por 10 s e o script mostra quadros
renderizados, quadros lentos (*janky*) e percentis de tempo por quadro (meta: p90 ≤ 16 ms e janky < 5%).
Repita em cada tela, com dados de verdade (peça ao menos 30 itens: use o seed/cadastros de teste):

```bash
scripts/perf/android-frames.sh 10 com.despacho.app   # abra "Pedidos abertos" e role
scripts/perf/android-frames.sh 10 com.despacho.app   # abra "Atualizações" e role
scripts/perf/android-frames.sh 10 com.despacho.app   # abra uma conversa com 100+ mensagens e role
```

Para investigar um gargalo, use o Perfetto/`adb shell perfetto` ou o *Profiler* do Android Studio com o build de
release (`debuggable` desligado só altera o resultado de forma desprezível; nunca meça em modo dev).

## Resultados

Preencha ao medir (mediana de 10 rodadas; fluidez com 10 s de rolagem).

| Data | Aparelho / Android / RAM | Abertura a frio (mediana) | Pedidos abertos (p90 · janky) | Atualizações (p90 · janky) | Chat (p90 · janky) |
|---|---|---|---|---|---|
| _pendente_ | _pendente_ | _pendente_ | _pendente_ | _pendente_ | _pendente_ |

## O que já foi verificado sem aparelho

- `npx expo-doctor`: 21/21 verificações sem problemas.
- Bundle Android com Hermes (`expo export --platform android`): **4,1 MB** de bytecode (`.hbc`), um ponto de
  partida para acompanhar: se crescer muito, a abertura piora em aparelho de entrada.
- Todas as listas usam **FlashList**, sem `ScrollView` + `map` para dados que crescem: home (pedidos e empresas),
  pedidos abertos **e "Seus pedidos"** (agora na mesma lista, porque os concluídos ficam 7 dias), atualizações e
  chat. As exceções são listas pequenas e limitadas (categorias, no máximo 5 miniaturas de foto).
- Tipos de item (`getItemType`) definidos nas listas heterogêneas, para o FlashList reaproveitar as células certas.
- Imagens: `expo-image`, sempre redimensionadas **antes** do upload (máx. 1000 px, JPEG ~80%).
- Eventos de socket invalidam só a consulta da tela afetada (TanStack Query).
- React Compiler ligado.

## Se não bater a meta

Em ordem de custo/benefício: (1) conferir se o build medido é mesmo o de release; (2) medir o que roda antes da
primeira tela (hidratar a sessão, o `useRealtime`, o registro de push) e adiar o que não é necessário para
desenhar; (3) reduzir o bundle (importações pesadas, `expo-image-picker`/mapas só sob demanda); (4) em listas,
simplificar a célula (menos `View` aninhado, sombras e transparências) e conferir `estimatedItemSize`/medições do
FlashList; (5) como último recurso, o módulo problemático vai para Kotlin via Expo Modules (ADR 0004).
