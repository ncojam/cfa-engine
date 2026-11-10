@echo off
rem Запуск редактора диалогов из корня CFA_Engine (Windows). Аргументы передаются как есть.
chcp 65001 >nul
cd /d "%~dp0editors\dialogue_editor"
python server.py %*
