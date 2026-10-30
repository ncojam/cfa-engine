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

# Обязательная палитра спрайтов: images/spr_palette.bmp (тайл 16x16)
# подставляется в левый верхний тайл каждого mss-*.bmp и chr_*.bmp.
# Исходники не трогаем — пропатченные копии кладём в out/spr_images,
# и ниже tmx2incl берёт спрайтовые картинки уже оттуда.
SPR_IMAGES=spr_images
python3 ../apply_spr_palette.py ../images/spr_palette.bmp ../images "$SPR_IMAGES"

"$TMX2INCL" b "$SPR_IMAGES"/mss-chars.bmp gr_chars
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
"$TMX2INCL" bp ../images/char15.bmp char15
"$TMX2INCL" bp ../images/char16.bmp char16
"$TMX2INCL" bp ../images/char17.bmp char17
"$TMX2INCL" bp ../images/char18.bmp char18
"$TMX2INCL" bp ../images/char19.bmp char19
"$TMX2INCL" bp ../images/char20.bmp char20
"$TMX2INCL" bp ../images/char21.bmp char21
"$TMX2INCL" bp ../images/char22.bmp char22
"$TMX2INCL" bp ../images/char23.bmp char23
"$TMX2INCL" bp ../images/char24.bmp char24
"$TMX2INCL" bp ../images/char25.bmp char25
"$TMX2INCL" bp ../images/char26.bmp char26
"$TMX2INCL" bp ../images/char27.bmp char27
"$TMX2INCL" bp ../images/char28.bmp char28
"$TMX2INCL" bp ../images/char29.bmp char29
"$TMX2INCL" bp ../images/char30.bmp char30
"$TMX2INCL" bp ../images/char31.bmp char31
"$TMX2INCL" bp ../images/char32.bmp char32
"$TMX2INCL" bp ../images/char33.bmp char33
"$TMX2INCL" bp ../images/char34.bmp char34
"$TMX2INCL" bp ../images/char35.bmp char35
"$TMX2INCL" bp ../images/char36.bmp char36
"$TMX2INCL" bp ../images/char37.bmp char37
"$TMX2INCL" b ../images/char38.bmp char38
"$TMX2INCL" bp ../images/char39.bmp char39
# Листы chr_spr_*.bmp собираем все, какие есть. Персонажей со своим тайлсетом
# (имя листа = имя персонажа из dataPointers) находит gen_char_sprites.py и
# генерирует src/char_sprites_gen.* (таблица chr_spr[] и charOwnTileset[]).
python3 ../tools/gen_char_sprites.py
for f in "$SPR_IMAGES"/chr_spr_*.bmp; do
    n=$(basename "$f" .bmp)
    "$TMX2INCL" b "$f" "$n"
done
"$TMX2INCL" b "$SPR_IMAGES"/mss-vika00.bmp vika00
"$TMX2INCL" bct ../images/mts-10.bmp ../resources/map-01-bg.tmx gr_main
"$TMX2INCL" bct ../images/mts-10.bmp ../resources/map-01.tmx gr_main
"$TMX2INCL" bct ../images/mts-01X.bmp ../resources/map-01.tmx gr_mainX
"$TMX2INCL" bct ../images/mts-01A.bmp ../resources/map-01.tmx gr_mainA
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_sprX
"$TMX2INCL" bct ../images/mts-02.bmp ../resources/map-02-bg.tmx gr_home
"$TMX2INCL" bct ../images/mts-02.bmp ../resources/map-02.tmx gr_home
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr2
"$TMX2INCL" bct ../images/mts-01A.bmp ../resources/map-03-bg.tmx gr_town
"$TMX2INCL" bct ../images/mts-01A.bmp ../resources/map-03.tmx gr_town
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr3
"$TMX2INCL" bct ../images/mts-04.bmp ../resources/map-04-bg.tmx gr_forest
"$TMX2INCL" bct ../images/mts-04.bmp ../resources/map-04.tmx gr_forest
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr4
# "$TMX2INCL" bct ../images/mts-05.bmp ../resources/map-05-bg.tmx gr_school
"$TMX2INCL" bct ../images/mts-05.bmp ../resources/map-05.tmx gr_school
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr5
# "$TMX2INCL" bct ../images/mts-town.bmp ../resources/map-town-bg.tmx gr_town0
"$TMX2INCL" bct ../images/mts-town.bmp ../resources/map-town.tmx gr_town0
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr6
"$TMX2INCL" bct ../images/mts-11.bmp ../resources/map-home.tmx gr_home0
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr7
"$TMX2INCL" bct ../images/mts-11.bmp ../resources/map-livingroom.tmx gr_home1
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr8
"$TMX2INCL" bct ../images/mts-demo.bmp ../resources/map-demo.tmx gr_demo
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr9
"$TMX2INCL" bct ../images/mts-abandon.bmp ../resources/map-abandon.tmx gr_abandon
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr10
"$TMX2INCL" bct ../images/mts-town-fun.bmp ../resources/map-town-fun-bg.tmx gr_backgr_town_fun
"$TMX2INCL" bct ../images/mts-town-fun.bmp ../resources/map-town-fun.tmx gr_town_fun
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr11
"$TMX2INCL" bct ../images/mts-101.bmp ../resources/map-101.tmx gr_101
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr12
"$TMX2INCL" bct ../images/placeholder.bmp ../resources/map-parking.tmx gr_parking
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr13
"$TMX2INCL" bct ../images/mts-class.bmp ../resources/map-class.tmx gr_class
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr14
"$TMX2INCL" bct ../images/mts-donuts.bmp ../resources/map-donuts.tmx gr_donuts
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr15
"$TMX2INCL" bct ../images/mts-bugor.bmp ../resources/map-bugor-bg.tmx gr_bugor
"$TMX2INCL" bct ../images/mts-bugor.bmp ../resources/map-bugor.tmx gr_bugor
"$TMX2INCL" b "$SPR_IMAGES"/mss-01.bmp gr_spr16
"$TMX2INCL" bct ../images/mts-downhill.bmp ../resources/map-downhill-bg.tmx gr_downhill
"$TMX2INCL" bct ../images/mts-downhill.bmp ../resources/map-downhill.tmx gr_downhill
"$TMX2INCL" b ../images/ui.bmp ui_thingie
"$TMX2INCL" b "$SPR_IMAGES"/mss-projectiles.bmp gfx_projectiles
"$TMX2INCL" b "$SPR_IMAGES"/chr_contacts.bmp chr_contacts
"$TMX2INCL" bctu ../images/mts-tittle.bmp ../resources/menu-tittle.tmx tittle_menu
# "$TMX2INCL" b ../images/cfa.bmp tl_cfa
# "$TMX2INCL" bct ../images/cfa.bmp ../resources/cfa.tmx cfa_logo
"$TMX2INCL" bct ../images/mts-bus.bmp ../resources/menu-bus.tmx bus_menu
"$TMX2INCL" bct ../images/mts-bus.bmp ../resources/menu-bus-bg.tmx bus_menu
"$TMX2INCL" bct ../images/mts-friends.bmp ../resources/menu-friends.tmx friends_menu
"$TMX2INCL" bct ../images/mts-test.bmp ../resources/menu.tmx pause_menu
"$TMX2INCL" bct ../images/mts-test.bmp ../resources/menu_inv_selection.tmx menu_inv_selection
"$TMX2INCL" bctu ../images/mts-ward.bmp ../resources/menu-ward.tmx ward_menu
