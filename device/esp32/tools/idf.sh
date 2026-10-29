#!/usr/bin/env bash
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export IDF_PATH="$project_dir/.sdk/esp-idf"
export IDF_TOOLS_PATH="$project_dir/.sdk/tools"
export IDF_SKIP_CHECK_SUBMODULES=1
cd "$project_dir"
if [ ! -f "$IDF_PATH/export.sh" ]; then
  echo 'Run python3 tools/bootstrap.py --idf --tools --archive-submodules first.' >&2
  exit 1
fi
. "$IDF_PATH/export.sh" >/dev/null
exec python "$IDF_PATH/tools/idf.py" "$@"
