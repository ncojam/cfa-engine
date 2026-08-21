#!/usr/bin/env bash
# Собирает вспомогательные хостовые утилиты (tmx2incl, wav2incl).
# Это НЕ ARM-код — программы запускаются на самой машине во время сборки
# ромов, чтобы сконвертировать bmp/wav/tmx в .inc-файлы. Поэтому они
# собираются обычным системным g++, а не devkitARM.
set -euo pipefail
cd "$(dirname "$0")"

CXX=${CXX_HOST:-g++}
CXXFLAGS="-O2 -std=gnu++17 -ffast-math"

for PROG in tmx2incl wav2incl; do
    echo "== building $PROG =="
    rm -f "$PROG"
    "$CXX" $CXXFLAGS "$PROG.cpp" -o "$PROG"
done

echo "Готово: $(pwd)/tmx2incl и $(pwd)/wav2incl"
