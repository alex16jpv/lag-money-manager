#!/usr/bin/env bash
set -euo pipefail

IMAGE="${MONGO_TOOLS_IMAGE:-mongo:8}"

usage() {
  cat <<'USAGE'
Usage: MONGO_URI='mongodb://host' npm run db:restore -- <archive>

Restores an archive written by `npm run db:backup`. THIS DESTROYS DATA: every
collection carried by the archive is dropped and rewritten. A collection that
exists in the target and is not in the archive is left alone.

MONGO_URI is read from the environment only, never from .env. Give the SERVER,
without a database path: the archive carries its own database names, and a path
there makes mongorestore silently restore nothing. The script names every
database it is about to overwrite and asks you to type them back.

Optional:
  MONGO_TOOLS_IMAGE  image providing mongorestore (default: mongo:8)
USAGE
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ARCHIVE="${1:-}"
[[ -n "$ARCHIVE" ]] || {
  usage >&2
  die "No archive given."
}
[[ -f "$ARCHIVE" ]] || die "Archive not found: $ARCHIVE"
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
gzip -t "$ARCHIVE" 2>/dev/null || die "Archive failed a gzip integrity check: $ARCHIVE"

[[ -n "${MONGO_URI:-}" ]] || {
  usage >&2
  die "MONGO_URI is not set."
}
export MONGO_URI

case "$MONGO_URI" in
  mongodb://* | mongodb+srv://*) ;;
  *) die "MONGO_URI must start with mongodb:// or mongodb+srv://" ;;
esac

body="${MONGO_URI#mongodb://}"
body="${body#mongodb+srv://}"
if [[ "$body" == *@* ]]; then
  CREDENTIALS="${body%@*}"
else
  CREDENTIALS=""
fi
body="${body##*@}"
body="${body%%\?*}"
URI_HOST="${body%%/*}"
[[ -n "$URI_HOST" ]] || die "MONGO_URI has no host."

[[ -t 0 ]] || die "This command destroys data and asks for confirmation; run it from a terminal."

command -v docker >/dev/null 2>&1 || die "docker is not installed; mongorestore runs inside a container."
docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable. Start Docker and retry."
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
  die "image '$IMAGE' is not available locally. Get it with: docker pull $IMAGE"

redact() {
  local line
  if [[ -z "$CREDENTIALS" ]]; then
    cat
    return
  fi
  while IFS= read -r line; do
    printf '%s\n' "${line//"$CREDENTIALS"/<credentials hidden>}"
  done
}

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

echo "==> Reading the archive against $URI_HOST (dry run, nothing is written yet)"
status=0
docker run --rm -i --network host -e MONGO_URI "$IMAGE" \
  sh -c 'exec mongorestore --uri="$MONGO_URI" --archive --gzip --dryRun -vv' <"$ARCHIVE" 2>&1 | redact >"$LOG" || status=$?

if [[ $status -ne 0 ]]; then
  tail -20 "$LOG" >&2
  die "the dry run failed (exit $status). Nothing was written."
fi

NAMESPACES="$(sed -n 's/.*bson to restore to `\([^`]*\)`.*/\1/p' "$LOG" | sort -u)"
if [[ -z "$NAMESPACES" ]]; then
  die "the dry run resolved 0 collections, so a restore would write nothing.
       The usual cause is a database path in MONGO_URI: mongorestore reads it as a
       filter and silently matches nothing. Pass the server alone, with no /database."
fi

DATABASES="$(printf '%s\n' "$NAMESPACES" | cut -d. -f1 | sort -u)"
EXPECTED="$(printf '%s' "$DATABASES" | tr '\n' ' ' | sed 's/ $//')"

echo
echo "About to restore"
echo "    archive   $ARCHIVE"
echo "              $(du -h "$ARCHIVE" | cut -f1), written $(date -r "$ARCHIVE" '+%Y-%m-%d %H:%M:%S %Z')"
echo "    server    $URI_HOST"
echo "    databases $EXPECTED"
echo
echo "These collections will be DROPPED and rewritten:"
printf '%s\n' "$NAMESPACES" | sed 's/^/    /'
echo
echo "A collection that exists on the server and is not in this list is left untouched."
echo
printf 'Type the database names exactly as shown to continue (%s): ' "$EXPECTED"
read -r answer
[[ "$answer" == "$EXPECTED" ]] || die "Confirmation did not match. Nothing was written."

echo
echo "==> Restoring"
status=0
docker run --rm -i --network host -e MONGO_URI "$IMAGE" \
  sh -c 'exec mongorestore --uri="$MONGO_URI" --archive --gzip --drop' <"$ARCHIVE" 2>&1 | redact | tee "$LOG" >&2 || status=$?

if [[ $status -ne 0 ]]; then
  die "mongorestore failed (exit $status). The target may be half-written: check it before using it."
fi

RESTORED="$(sed -n 's/.*[^0-9]\([0-9][0-9]*\) document(s) restored successfully.*/\1/p' "$LOG" | tail -1)"
FAILED="$(sed -n 's/.*successfully\. \([0-9][0-9]*\) document(s) failed.*/\1/p' "$LOG" | tail -1)"
RESTORED="${RESTORED:-0}"
FAILED="${FAILED:-0}"

[[ "$FAILED" -eq 0 ]] ||
  die "$FAILED document(s) failed to restore. The target is incomplete: check it before using it."

echo
echo "==> Restore complete"
echo "    databases $EXPECTED on $URI_HOST"
echo "    documents $RESTORED"
if [[ "$RESTORED" -eq 0 ]]; then
  echo
  echo "WARNING: 0 documents were restored. The collections exist but the archive carried" >&2
  echo "         no documents. Check that this archive is the one you meant to use." >&2
fi
