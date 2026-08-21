#!/usr/bin/env bash
# Замена build_graphics.bat.
# tmx2incl собирается из tools/build_tools.sh (см. tools/).
set -euo pipefail
cd "$(dirname "$0")"

# По умолчанию считаем, что tools/ лежит рядом с project/ (общий родитель),
# как и было в исходной раскладке ("..\..\tmx2incl.exe" из project/out).
# Переопредели переменной окружения TOOLS_DIR, если у тебя другая структура.
TOOLS_DIR=${TOOLS_DIR:-../../tools}
TMX2INCL="$TOOLS_DIR/tmx2incl"

mkdir -p out
cd out

if [ ! -x "$TMX2INCL" ]; then
    echo "Не найден исполняемый файл $TMX2INCL (искали относительно $(pwd))" >&2
    echo "Сначала выполни: tools/build_tools.sh" >&2
    echo "Либо укажи путь: TOOLS_DIR=/путь/к/tools ./build_graphics.sh" >&2
    exit 1
fi

"$TMX2INCL" bct ../images/mts-10.bmp ../resources/map-01-bg.tmx gr_main
"$TMX2INCL" bct ../images/mts-10.bmp ../resources/map-01.tmx gr_main
"$TMX2INCL" bct ../images/mts-01X.bmp ../resources/map-01.tmx gr_mainX
"$TMX2INCL" bct ../images/mts-01A.bmp ../resources/map-01.tmx gr_mainA
"$TMX2INCL" b ../images/mss-01.bmp gr_spr
"$TMX2INCL" b ../images/mss-01x.bmp gr_sprX
"$TMX2INCL" bct ../images/mts-02.bmp ../resources/map-02-bg.tmx gr_home
"$TMX2INCL" bct ../images/mts-02.bmp ../resources/map-02.tmx gr_home
"$TMX2INCL" b ../images/mss-02.bmp gr_spr2
"$TMX2INCL" bct ../images/mts-01A.bmp ../resources/map-03-bg.tmx gr_town
"$TMX2INCL" bct ../images/mts-01A.bmp ../resources/map-03.tmx gr_town
"$TMX2INCL" b ../images/mss-01.bmp gr_spr3
"$TMX2INCL" bct ../images/mts-04.bmp ../resources/map-04-bg.tmx gr_forest
"$TMX2INCL" bct ../images/mts-04.bmp ../resources/map-04.tmx gr_forest
"$TMX2INCL" b ../images/mss-01.bmp gr_spr4
# "$TMX2INCL" bct ../images/mts-05.bmp ../resources/map-05-bg.tmx gr_school
"$TMX2INCL" bct ../images/mts-05.bmp ../resources/map-05.tmx gr_school
"$TMX2INCL" b ../images/mss-01.bmp gr_spr5
# "$TMX2INCL" bct ../images/mts-town.bmp ../resources/map-town-bg.tmx gr_town0
"$TMX2INCL" bct ../images/mts-town.bmp ../resources/map-town.tmx gr_town0
"$TMX2INCL" b ../images/mss-01.bmp gr_spr6
"$TMX2INCL" bct ../images/mts-11.bmp ../resources/map-home.tmx gr_home0
"$TMX2INCL" b ../images/mss-01.bmp gr_spr7
"$TMX2INCL" bct ../images/mts-11.bmp ../resources/map-livingroom.tmx gr_home1
"$TMX2INCL" b ../images/mss-01.bmp gr_spr8
"$TMX2INCL" bct ../images/mts-demo.bmp ../resources/map-demo.tmx gr_demo
"$TMX2INCL" b ../images/mss-01.bmp gr_spr9
"$TMX2INCL" bct ../images/mts-abandon.bmp ../resources/map-abandon.tmx gr_abandon
"$TMX2INCL" b ../images/mss-01.bmp gr_spr10
"$TMX2INCL" b ../images/ui.bmp ui_thingie
"$TMX2INCL" bctu ../images/mts-tittle.bmp ../resources/menu-tittle.tmx tittle_menu
# "$TMX2INCL" b ../images/cfa.bmp tl_cfa
# "$TMX2INCL" bct ../images/cfa.bmp ../resources/cfa.tmx cfa_logo
"$TMX2INCL" b ../images/mss-chars.bmp gr_chars
"$TMX2INCL" bp ../images/characters.bmp characters
"$TMX2INCL" bp ../images/char00.bmp char00
"$TMX2INCL" bp ../images/char01.bmp char01
"$TMX2INCL" bp ../images/char02.bmp char02
"$TMX2INCL" bp ../images/char03.bmp char03
"$TMX2INCL" bp ../images/char04.bmp char04
"$TMX2INCL" bp ../images/char05.bmp char05
"$TMX2INCL" bp ../images/char06.bmp char06
"$TMX2INCL" bp ../images/char07.bmp char07
"$TMX2INCL" bp ../images/char08.bmp char08
"$TMX2INCL" bp ../images/char09.bmp char09
"$TMX2INCL" bp ../images/char10.bmp char10
"$TMX2INCL" bp ../images/char11.bmp char11
"$TMX2INCL" bp ../images/char12.bmp char12
"$TMX2INCL" bp ../images/char13.bmp char13
"$TMX2INCL" bp ../images/char14.bmp char14
"$TMX2INCL" bct ../images/mts-test.bmp ../resources/menu.tmx pause_menu
"$TMX2INCL" bctu ../images/mts-ward.bmp ../resources/menu-ward.tmx ward_menu
