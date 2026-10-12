#!/bin/sh
set -efu
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
NODE_SETTING=${SCWC_NODE_PATH-}
if [ -f "$APP_DIR/.env" ]; then
  FILE_SETTING=$(awk -v bom="$(printf '\357\273\277')" '
    { line=$0; sub("^" bom, "", line); sub(/\r$/, "", line) }
    line ~ /^[ \t]*(export[ \t]+)?SCWC_NODE_PATH[ \t]*=/ {
      sub(/^[ \t]*(export[ \t]+)?SCWC_NODE_PATH[ \t]*=[ \t]*/, "", line)
      quote=substr(line,1,1)
      if (quote == sprintf("%c",34) || quote == sprintf("%c",39)) {
        rest=substr(line,2); ending=index(rest,quote)
        if (!ending || substr(rest,ending+1) !~ /^[ \t]*(#.*)?$/) { exit 2 }
        value=substr(rest,1,ending-1)
      } else {
        if (line ~ /["\047]/) { exit 2 }
        sub(/#.*/, "", line); sub(/[ \t]+$/, "", line); value=line
      }
      found=1
    }
    END { if (found) print "SCWC_NODE_PATH=" value }
  ' "$APP_DIR/.env") || { echo 'Invalid SCWC_NODE_PATH in .env.' >&2; exit 1; }
  case "$FILE_SETTING" in SCWC_NODE_PATH=*) NODE_SETTING=${FILE_SETTING#SCWC_NODE_PATH=} ;; esac
fi
probe_node() {
  NODE_OPTIONS= "$1" "$APP_DIR/start.cjs" --check-node 2>/dev/null
}
SELECTED_NODE=
if [ -n "$NODE_SETTING" ]; then
  case "$NODE_SETTING" in /*) CANDIDATE=$NODE_SETTING ;; *) CANDIDATE=$APP_DIR/$NODE_SETTING ;; esac
  SELECTED_NODE=$(probe_node "$CANDIDATE") || { echo 'SCWC_NODE_PATH does not point to a compatible Node.js >=25.' >&2; exit 1; }
else
  # Iterate PATH rather than stopping at an older Node in its first directory.
  SAVED_IFS=$IFS
  IFS=:
  for DIR in ${PATH-}; do
    IFS=$SAVED_IFS
    CANDIDATE=${DIR:-.}/node
    if [ -x "$CANDIDATE" ]; then
      if SELECTED_NODE=$(probe_node "$CANDIDATE"); then break; fi
    fi
    IFS=:
  done
  IFS=$SAVED_IFS
fi
if [ -z "$SELECTED_NODE" ]; then
  echo 'No compatible Node.js >=25 was found. Set SCWC_NODE_PATH in the adjacent .env file.' >&2
  exit 1
fi
exec "$SELECTED_NODE" "$APP_DIR/start.cjs" "$@"
