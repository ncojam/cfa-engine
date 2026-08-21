#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -f *.elf *.s *.o *.inc tmx2incl wav2incl
echo "tools/: очищено"
