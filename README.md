# CFA Engine

Базовая связка тулчейна и скриптов сборки для homebrew-игр на Game Boy Advance
(devkitARM / devkitPro). Репозиторий содержит только движковую часть —
скрипты сборки и вспомогательные конвертеры ассетов. Исходники конкретной
игры (`project/src/`, `project/images/`, `project/resources/`,
`project/sounds/`) в репозиторий не входят, см. `.gitignore`.

## Структура

```
.
├── tools/              # хостовые утилиты-конвертеры (bmp/tmx/wav → .inc)
│   ├── tmx2incl.cpp
│   ├── wav2incl.cpp
│   ├── gbadbg/         # отладчик на ядре mGBA (перемотка, тайлы/спрайты, diff памяти), см. его README
│   ├── build_tools.sh
│   └── clean.sh
└── project/             # сборка самого рома
    ├── Makefile
    ├── build.sh
    ├── build_graphics.sh
    ├── build_sounds.sh
    ├── clean.sh
    ├── src/              # (не в репо) исходники игры
    ├── images/           # (не в репо) .bmp
    ├── resources/        # (не в репо) .tmx
    └── sounds/           # (не в репо) .wav
```

## Требования

- [devkitPro](https://devkitpro.org/wiki/Getting_Started) с установленным `devkitARM`
- Переменные окружения `DEVKITPRO` и `DEVKITARM`, добавленные в `PATH`
  (пример для fish — `~/.config/fish/config.fish`):
  ```fish
  set -gx DEVKITPRO /opt/devkitpro
  set -gx DEVKITARM /opt/devkitpro/devkitARM
  set -gx DEVKITPPC /opt/devkitpro/devkitPPC
  set -gx PATH $DEVKITARM/bin $DEVKITPRO/tools/bin $PATH
  ```
- Системный `g++` (для сборки хостовых утилит в `tools/` — они компилируются
  под хост, а не под ARM)

## Сборка

```bash
chmod +x tools/*.sh project/*.sh

# 1. Собрать хостовые утилиты-конвертеры (один раз, либо после их изменения)
./tools/build_tools.sh

# 2. Сгенерировать графику/звук и собрать сам ром
cd project
./build_graphics.sh
./build_sounds.sh
./build.sh
```

После успешной сборки `.gba`-файл появится в `project/`.

Чтобы очистить артефакты сборки:

```bash
./tools/clean.sh
./project/clean.sh
```

## Добавление своей игры

Положи исходники игры в `project/src/`, ассеты — в `project/images/`,
`project/resources/`, `project/sounds/`. Эти папки исключены из репозитория
через `.gitignore`, так что движковая часть репо остаётся переиспользуемой
базой для разных проектов.
