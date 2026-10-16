#!/usr/bin/env bash
# Mede a fluidez de uma lista no app num aparelho Android conectado (adb): zera as estatísticas de quadros,
# você rola a lista por alguns segundos e o script mostra quadros renderizados, lentos e percentis.
# Uso: scripts/perf/android-frames.sh [segundos=10] [pacote=com.despacho.app]
# Meta: lista a 60 fps = (quase) nenhum quadro acima de 16,6 ms.
set -euo pipefail

SECONDS_TO_SCROLL="${1:-10}"
PKG="${2:-com.despacho.app}"

command -v adb >/dev/null || { echo "adb não encontrado (instale o Android platform-tools)" >&2; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "Nenhum aparelho Android conectado (adb devices)" >&2; exit 1; }

adb shell dumpsys gfxinfo "$PKG" reset >/dev/null
echo "Role a lista no aparelho por ${SECONDS_TO_SCROLL} s (de baixo a cima, sem parar)…"
sleep "$SECONDS_TO_SCROLL"
adb shell dumpsys gfxinfo "$PKG" | tr -d '\r' | awk '
  /Total frames rendered/ {print}
  /Janky frames/ {print}
  /50th percentile/ {print}
  /90th percentile/ {print}
  /95th percentile/ {print}
  /99th percentile/ {print}
  /Number Missed Vsync|Number Slow UI thread|Number Slow bitmap uploads|Number Slow issue draw commands/ {print}'
