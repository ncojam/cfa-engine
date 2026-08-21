#!/usr/bin/env bash
# Замена build_sounds.bat.
# wav2incl собирается из tools/build_tools.sh (см. tools/).
set -euo pipefail
cd "$(dirname "$0")"

TOOLS_DIR=${TOOLS_DIR:-../../tools}
WAV2INCL="$TOOLS_DIR/wav2incl"

mkdir -p out
cd out

if [ ! -x "$WAV2INCL" ]; then
    echo "Не найден исполняемый файл $WAV2INCL (искали относительно $(pwd))" >&2
    echo "Сначала выполни: tools/build_tools.sh" >&2
    echo "Либо укажи путь: TOOLS_DIR=/путь/к/tools ./build_sounds.sh" >&2
    exit 1
fi

"$WAV2INCL" ../sounds/snd-c-expl-grenade.wav snd_bank.inc snd_expl_grenade
"$WAV2INCL" ../sounds/snd-c-footstep.wav +snd_bank.inc snd_footstep
"$WAV2INCL" ../sounds/snd-c-hit-death.wav +snd_bank.inc snd_hit_death
"$WAV2INCL" ../sounds/snd-c-shot-pistol.wav +snd_bank.inc snd_shot_pistol
"$WAV2INCL" ../sounds/snd-c-shot-enemy-pistol.wav +snd_bank.inc snd_shot_enemy_pistol
# "$WAV2INCL" ../sounds/snd-c-throw.wav +snd_bank.inc snd_throw
"$WAV2INCL" ../sounds/snd-c-start.wav +snd_bank.inc snd_start
"$WAV2INCL" ../sounds/snd-door.wav +snd_bank.inc snd_door
"$WAV2INCL" ../sounds/snd-click.wav +snd_bank.inc snd_click
"$WAV2INCL" ../sounds/snd-click-cant.wav +snd_bank.inc snd_click_cant
"$WAV2INCL" ../sounds/snd-m-chat-open.wav +snd_bank.inc snd_m_chat_open
"$WAV2INCL" ../sounds/snd-m-chat-close.wav +snd_bank.inc snd_m_chat_close
"$WAV2INCL" ../sounds/snd-m-chat-next.wav +snd_bank.inc snd_m_chat_next
"$WAV2INCL" ../sounds/snd-m-page.wav +snd_bank.inc snd_m_page
"$WAV2INCL" ../sounds/snd-a-bird.wav +snd_bank.inc snd_a_bird
"$WAV2INCL" ../sounds/snd-a-bell.wav +snd_bank.inc snd_a_bell
"$WAV2INCL" ../sounds/bgm-01.wav +snd_bank.inc snd_bgm01
"$WAV2INCL" ../sounds/bgm-03.wav +snd_bank.inc snd_bgm03
"$WAV2INCL" ../sounds/bgm-04.wav +snd_bank.inc snd_bgm04
"$WAV2INCL" ../sounds/track0/guit-post01_.wav +snd_bank.inc snd_guit_post01
"$WAV2INCL" ../sounds/track0/guit-post02_.wav +snd_bank.inc snd_guit_post02
"$WAV2INCL" ../sounds/track0/guit-post03_.wav +snd_bank.inc snd_guit_post03
"$WAV2INCL" ../sounds/track0/guit-post04_.wav +snd_bank.inc snd_guit_post04
"$WAV2INCL" ../sounds/track0/guit-01_.wav +snd_bank.inc snd_guit01
"$WAV2INCL" ../sounds/track0/guit-02_.wav +snd_bank.inc snd_guit02
"$WAV2INCL" ../sounds/track0/guit-03_.wav +snd_bank.inc snd_guit03
"$WAV2INCL" ../sounds/track0/guit-04_.wav +snd_bank.inc snd_guit04
"$WAV2INCL" ../sounds/track0/guit-05_.wav +snd_bank.inc snd_guit05
"$WAV2INCL" ../sounds/track0/guit-06_.wav +snd_bank.inc snd_guit06
