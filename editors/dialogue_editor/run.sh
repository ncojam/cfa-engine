#!/usr/bin/env bash
# Graveblood dialogue editor
# Перед стартом гасит уже запущенный экземпляр этого же редактора
# (иначе "Address already in use", а в браузере остаётся старый код).
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

# cmdline процесса должен НАЧИНАТЬСЯ с python и содержать server.py из этой папки
PAT="^python[0-9.]* (${DIR}/)?server\.py"
old=$(pgrep -f "$PAT" || true)
if [ -n "$old" ]; then
    echo "Останавливаю старый экземпляр редактора (pid: $(echo $old | tr '\n' ' '))"
    kill $old 2>/dev/null
    for _ in $(seq 1 20); do   # до ~2 сек ждём, пока освободится порт
        pgrep -f "$PAT" >/dev/null || break
        sleep 0.1
    done
    pkill -9 -f "$PAT" 2>/dev/null
fi

exec python3 server.py "$@"
