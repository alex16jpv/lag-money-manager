#!/usr/bin/env bash
set -euo pipefail

IMAGE="${MONGO_TOOLS_IMAGE:-mongo:8}"

usage() {
  cat <<'USAGE'
Usage: MONGO_URI='mongodb://host[/database]' npm run db:restore -- <archive>

Restores an archive written by `npm run db:backup`. THIS DESTROYS DATA: every
collection carried by the archive is dropped and rewritten in the target. A
collection that exists in the target and is not in the archive is left alone.

MONGO_URI is read from the environment only, never from .env.

  ...mongodb://host            restores into the databases the archive came from
  ...mongodb://host/other_db   restores into `other_db` instead

The second form is how you check an archive without touching anything real:

  MONGO_URI='mongodb://localhost:27017/lag_money_check' npm run db:restore -- <archive>

The script names the server and the exact databases it is about to overwrite,
and asks you to type the server host back.

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

[[ $# -le 1 ]] || {
  usage >&2
  die "This command takes exactly one argument: the archive to restore."
}

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

case "$MONGO_URI" in
  mongodb://*) SCHEME="mongodb://" ;;
  mongodb+srv://*) SCHEME="mongodb+srv://" ;;
  *) die "MONGO_URI must start with mongodb:// or mongodb+srv://" ;;
esac

rest="${MONGO_URI#"$SCHEME"}"
if [[ "$rest" == *\?* ]]; then
  QUERY="?${rest#*\?}"
else
  QUERY=""
fi
before="${rest%%\?*}"
if [[ "$before" == *@* ]]; then
  CREDENTIALS="${before%@*}"
  USERINFO="${CREDENTIALS}@"
  hostpath="${before##*@}"
else
  CREDENTIALS=""
  USERINFO=""
  hostpath="$before"
fi
URI_HOST="${hostpath%%/*}"
if [[ "$hostpath" == */* ]]; then
  TARGET_DB="${hostpath#*/}"
else
  TARGET_DB=""
fi

[[ -n "$URI_HOST" ]] || die "MONGO_URI has no host."
[[ -z "$TARGET_DB" || "$TARGET_DB" =~ ^[A-Za-z0-9_-]+$ ]] ||
  die "'$TARGET_DB' is not a usable database name. Give MONGO_URI as <host> or <host>/<database>, with any options after a '?'."

TOOL_URI="${SCHEME}${USERINFO}${URI_HOST}/${QUERY}"
export TOOL_URI

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
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "${line//"$CREDENTIALS"/<credentials hidden>}"
  done
}

LOG="$(mktemp)"
CIDFILE="$(mktemp -u)"
WRITING=0
EXPECTED=""

cleanup() {
  if [[ -s "$CIDFILE" ]]; then
    docker rm -f "$(cat "$CIDFILE")" >/dev/null 2>&1 || true
  fi
  if [[ "$WRITING" -ne 0 ]]; then
    echo >&2
    echo "The restore was stopped part-way. Collections already dropped are gone and the" >&2
    echo "ones being written are incomplete: $EXPECTED on $URI_HOST is NOT usable as it" >&2
    echo "stands. Run this restore again, to the end, before using that server." >&2
  fi
  rm -f "$CIDFILE" "$LOG"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

echo "==> Reading the archive against $URI_HOST (dry run, nothing is written yet)"
status=0
docker run --rm --cidfile "$CIDFILE" -i --network host -e TOOL_URI "$IMAGE" \
  sh -c 'exec mongorestore --uri="$TOOL_URI" --archive --gzip --dryRun -vv' <"$ARCHIVE" 2>&1 | redact >"$LOG" || status=$?
rm -f "$CIDFILE"

if [[ $status -ne 0 ]]; then
  tail -20 "$LOG" >&2
  die "the dry run failed (exit $status). Nothing was written."
fi

NAMESPACES="$(sed -n 's/.*bson to restore to `\([^`]*\)`.*/\1/p' "$LOG" | sort -u)"
if [[ -z "$NAMESPACES" ]]; then
  tail -20 "$LOG" >&2
  die "the dry run resolved 0 collections, so a restore would write nothing.
       This archive carries nothing to restore. Nothing was written."
fi

SOURCE_DBS="$(printf '%s\n' "$NAMESPACES" | cut -d. -f1 | sort -u)"
NS_ARGS=()
if [[ -n "$TARGET_DB" ]]; then
  if [[ "$(printf '%s\n' "$SOURCE_DBS" | wc -l)" -ne 1 ]]; then
    die "MONGO_URI names one database ('$TARGET_DB') but the archive carries several
         ($(printf '%s' "$SOURCE_DBS" | tr '\n' ' ')). There is no unambiguous way to map
         them: drop the database from the URI to restore each into its own name."
  fi
  NS_ARGS=(--nsFrom "${SOURCE_DBS}.*" --nsTo "${TARGET_DB}.*")
  TARGET_NAMESPACES="$(printf '%s\n' "$NAMESPACES" | sed "s/^${SOURCE_DBS}\./${TARGET_DB}./")"
  EXPECTED="$TARGET_DB"
  RENAME_FROM="$SOURCE_DBS"
else
  TARGET_NAMESPACES="$NAMESPACES"
  EXPECTED="$(printf '%s' "$SOURCE_DBS" | tr '\n' ' ' | sed 's/ $//')"
  RENAME_FROM=""
fi

echo
echo "About to restore"
echo "    archive   $ARCHIVE"
echo "              $(du -h "$ARCHIVE" | cut -f1), written $(date -r "$ARCHIVE" '+%Y-%m-%d %H:%M:%S %Z')"
echo "    server    $URI_HOST"
if [[ -n "$RENAME_FROM" ]]; then
  echo "    databases $RENAME_FROM (in the archive)  ->  $EXPECTED (on the server)"
else
  echo "    databases $EXPECTED"
fi
echo
echo "These collections will be DROPPED and rewritten:"
printf '%s\n' "$TARGET_NAMESPACES" | sed 's/^/    /'
echo
echo "A collection that exists on the server and is not in this list is left untouched."
echo
echo "The server is the part that decides whether this is a rehearsal or the real thing,"
echo "so that is what you confirm. Type it exactly, or anything else to abort."
echo
printf 'Server to overwrite [%s]: ' "$URI_HOST"
read -r answer
[[ "$answer" == "$URI_HOST" ]] ||
  die "Typed '$answer', expected '$URI_HOST'. Nothing was written."

echo
echo "==> Restoring"
status=0
WRITING=1
docker run --rm --cidfile "$CIDFILE" -i --network host -e TOOL_URI "$IMAGE" \
  sh -c 'exec mongorestore --uri="$TOOL_URI" --archive --gzip --drop "$@"' sh "${NS_ARGS[@]}" <"$ARCHIVE" 2>&1 | redact | tee "$LOG" >&2 || status=$?
WRITING=0

if [[ $status -ne 0 ]]; then
  die "mongorestore failed (exit $status). The target may be half-written: check it before using it."
fi

RESTORED="$(sed -n 's/.*[^0-9]\([0-9][0-9]*\) document(s) restored successfully.*/\1/p' "$LOG" | tail -1)"
FAILED="$(sed -n 's/.*successfully\. \([0-9][0-9]*\) document(s) failed.*/\1/p' "$LOG" | tail -1)"
RESTORED="${RESTORED:-0}"
FAILED="${FAILED:-0}"

[[ "$FAILED" -eq 0 ]] ||
  die "$FAILED document(s) failed to restore. The target is incomplete: check it before using it."

if [[ "$RESTORED" -eq 0 ]]; then
  die "0 documents were restored, but collections were already dropped. The archive
       carried no documents: $EXPECTED on $URI_HOST is now empty. Restore a real
       archive before using that server."
fi

echo
echo "==> Restore complete"
echo "    databases $EXPECTED on $URI_HOST"
echo "    documents $RESTORED"
