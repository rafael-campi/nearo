#!/usr/bin/env bash
# Mede a abertura a frio do app num aparelho Android conectado (adb), em N rodadas.
# Uso: scripts/perf/android-startup.sh [rodadas=10] [pacote=com.despacho.app]
# Mostra o TotalTime de `am start -W` (da intenção até a primeira tela desenhada) de cada rodada e a mediana.
set -euo pipefail

RUNS="${1:-10}"
PKG="${2:-com.despacho.app}"
ACTIVITY="$PKG/.MainActivity"

command -v adb >/dev/null || { echo "adb não encontrado (instale o Android platform-tools)" >&2; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "Nenhum aparelho Android conectado (adb devices)" >&2; exit 1; }

echo "Aparelho: $(adb shell getprop ro.product.model | tr -d '\r') · Android $(adb shell getprop ro.build.version.release | tr -d '\r') · RAM $(adb shell grep MemTotal /proc/meminfo | tr -d '\r' | awk '{print int($2/1024) " MB"}')"
times=()
for i in $(seq 1 "$RUNS"); do
  adb shell am force-stop "$PKG"
  adb shell input keyevent KEYCODE_HOME
  sleep 2 # deixa o aparelho assentar entre as rodadas
  ms=$(adb shell am start -W -n "$ACTIVITY" | tr -d '\r' | awk '/TotalTime/ {print $2}')
  echo "rodada $i: ${ms} ms"
  times+=("$ms")
done
printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1} END {m=(NR%2)?a[(NR+1)/2]:(a[NR/2]+a[NR/2+1])/2; print "mediana: " m " ms (meta: < 2000 ms)"}'
