#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -f out/*.elf out/*.dep out/*.o out/*.s out/*.inc
echo "project/: очищено"
