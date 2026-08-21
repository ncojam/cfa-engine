#!/usr/bin/env bash
# Полный аналог build.bat.
# devkitpro.bat больше не нужен отдельным шагом: DEVKITPRO/DEVKITARM/PATH
# уже экспортируются глобально в твоём shell (fish config), а флаги
# компиляции (CXX/PARAMS) теперь зашиты прямо в Makefile.
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${DEVKITARM:-}" ]; then
    echo "Ошибка: переменная DEVKITARM не установлена. Проверь ~/.config/fish/config.fish" >&2
    exit 1
fi

make dep
make
