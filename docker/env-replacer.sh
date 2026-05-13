#!/usr/bin/env sh

set -e

# Directories to scan can be overridden via TARGET_DIRS="dir1 dir2".
TARGET_DIRS="${TARGET_DIRS:-apps/web/dist}"

# Space-separated glob patterns to ignore during the search.
EXCLUDE_PATTERNS="${EXCLUDE_PATTERNS:-*/node_modules/* */cache/*}"

case "$(uname -s)" in
  Darwin*)
    sed_inplace() {
      LC_ALL=C sed -i '' "$@"
    }
    ;;
  *)
    sed_inplace() {
      LC_ALL=C sed -i "$@"
    }
    ;;
esac

emit_files() {
  dir=$1

  [ -d "$dir" ] || return 0

  (
    set -f
    set -- find "$dir"
    first_pattern=1

    for pattern in $EXCLUDE_PATTERNS; do
      [ -n "$pattern" ] || continue

      if [ "$first_pattern" -eq 1 ]; then
        set -- "$@" "("
        first_pattern=0
      else
        set -- "$@" -o
      fi

      set -- "$@" -path "$pattern"
    done

    if [ "$first_pattern" -eq 0 ]; then
      set -- "$@" ")" -prune -o
    fi

    set -- "$@" -type f -print0
    "$@"
  )
}

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\\/&|]/\\&/g'
}

has_target_dir=false
for target_dir in $TARGET_DIRS; do
  if [ -d "$target_dir" ]; then
    has_target_dir=true
    break
  fi
done

if [ "$has_target_dir" = false ]; then
  exec "$@"
fi

printenv | while IFS= read -r ENV_LINE; do
  case "$ENV_LINE" in
    VITE_*=*|NEXT_PUBLIC_*=*)
      ENV_KEY=${ENV_LINE%%=*}
      ENV_VALUE=${ENV_LINE#*=}
      REPLACEMENT=$(escape_sed_replacement "$ENV_VALUE")

      for target_dir in $TARGET_DIRS; do
        [ -d "$target_dir" ] || continue

        emit_files "$target_dir" | while IFS= read -r -d '' file_path; do
          sed_inplace "s|_${ENV_KEY}_|$REPLACEMENT|g" "$file_path"
        done
      done
      ;;
  esac
done

# Execute the application main command.
exec "$@"
