#!/usr/bin/env bash
# Собрать отладчик (если нужно), пересобрать игру и запустить её в gbadbg.
#   ./gbadbg.sh              - игра project/graveblood.gba
#   ./gbadbg.sh --no-build   - без пересборки игры (запустить как есть)
#   ./gbadbg.sh другой.gba   - другой ром (тогда игра не пересобирается)
# Остальные аргументы (--history-mb 2048 и т.п.) передаются в gbadbg.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
GAME="$ROOT/project"
DBG="$ROOT/tools/gbadbg"
ROM="$GAME/graveblood.gba"
BUILD_GAME=1
ARGS=()
for a in "$@"; do
	case "$a" in
		--no-build) BUILD_GAME=0 ;;
		*.gba) ROM="$(realpath "$a")"; BUILD_GAME=0 ;;
		*) ARGS+=("$a") ;;
	esac
done

# ---- 1. отладчик: первая конфигурация + пересборка изменённого ----
if [ ! -f "$DBG/build/CMakeCache.txt" ]; then
	echo "== gbadbg: первая конфигурация (скачает mGBA и ImGui)"
	cmake -S "$DBG" -B "$DBG/build" -DCMAKE_BUILD_TYPE=Release
fi
echo "== gbadbg: сборка"
cmake --build "$DBG/build" -j"$(nproc)"

# ---- 2. игра ----
if [ "$BUILD_GAME" = 1 ]; then
	if [ -z "${DEVKITARM:-}" ]; then
		echo "DEVKITARM не задан - игру не собираю (проверь fish config)" >&2
		exit 1
	fi
	if grep -q -- '-g0' "$GAME/Makefile"; then
		echo "!! В project/Makefile ещё -g0: сделай git pull в project, иначе не будет имён функций и строк" >&2
	fi
	# Один раз после перехода на -g пересобираем объектники, чтобы отладочная информация была во всех.
	# Удаляются ТОЛЬКО out/*.o, у которых есть исходник src/*.cpp (их и так соберёт make).
	# .inc, .s и прочие файлы в out/ не трогаем.
	STAMP="$GAME/out/.gbadbg-debuginfo"
	if [ ! -f "$STAMP" ] && ! grep -q -- '-g0' "$GAME/Makefile"; then
		echo "== игра: разовая пересборка объектников с -g"
		( cd "$GAME"
		  find src -name '*.cpp' | while read -r cpp; do
			o="out/${cpp#src/}"; o="${o%.cpp}.o"
			rm -f "$o"
		  done )
		REBUILT=1
	fi
	echo "== игра: сборка"
	( cd "$GAME" && ./build.sh )
	[ "${REBUILT:-0}" = 1 ] && touch "$STAMP"
fi

# ---- 3. запуск ----
echo "== запуск: $ROM"
exec "$DBG/build/gbadbg" "$ROM" "${ARGS[@]}"
