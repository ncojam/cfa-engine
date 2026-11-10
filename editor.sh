#!/usr/bin/env bash
# Запуск редактора диалогов (editors/dialogue_editor) из корня CFA_Engine.
# Аргументы передаются как есть: ./editor.sh --no-browser --port 9000
exec "$(cd "$(dirname "$0")" && pwd)/editors/dialogue_editor/run.sh" "$@"
