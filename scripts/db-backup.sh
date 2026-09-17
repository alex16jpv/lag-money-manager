#!/usr/bin/env bash
set -euo pipefail

IMAGE="${MONGO_TOOLS_IMAGE:-mongo:8}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/ledger-flow-backups}"

usage() {
  cat <<'USAGE'
Usage: MONGO_URI='mongodb+srv://user:pass@cluster.mongodb.net/lag_money' npm run db:backup

Dumps the database named in MONGO_URI to a dated, gzipped archive.

MONGO_URI is read from the environment only, never from .env: that file's value
changes, and a backup must say out loud which database it touched. The URI has
to name a database -- the dump is scoped to it.

Optional:
  BACKUP_DIR         where archives are written (default: ~/ledger-flow-backups)
  MONGO_TOOLS_IMAGE  image providing mongodump (default: mongo:8)

The archive restores with:
  MONGO_URI='mongodb+srv://user:pass@cluster.mongodb.net/' npm run db:restore -- <archive>
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

[[ $# -eq 0 ]] || {
  usage >&2
  die "This command takes no arguments; configuration comes from the environment."
}

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
body="${body%%\?*}"
if [[ "$body" == *@* ]]; then
  CREDENTIALS="${body%@*}"
  body="${body##*@}"
else
  CREDENTIALS=""
fi
URI_HOST="${body%%/*}"
if [[ "$body" == */* ]]; then
  DB="${body#*/}"
else
  DB=""
fi

[[ -n "$URI_HOST" ]] || die "MONGO_URI has no host."
[[ -n "$DB" ]] || die "MONGO_URI names no database. Append /<database> so the dump is scoped to it."
[[ "$DB" =~ ^[A-Za-z0-9_-]+$ ]] ||
  die "'$DB' is not a usable database name. Give MONGO_URI as <host>/<database>, with any options after a '?'."

mkdir -m 700 -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
if [[ "$(stat -c '%a' "$BACKUP_DIR")" != "700" ]]; then
  echo "WARNING: $BACKUP_DIR is readable beyond you ($(stat -c '%A' "$BACKUP_DIR")). The archives" >&2
  echo "         themselves are written 600, but consider: chmod 700 '$BACKUP_DIR'" >&2
fi
if git -C "$BACKUP_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  die "BACKUP_DIR is inside a git repository ($BACKUP_DIR). A dump carries real user data: choose a directory outside git."
fi

command -v docker >/dev/null 2>&1 || die "docker is not installed; mongodump runs inside a container."
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

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
NAME="${DB}-${STAMP}.archive.gz"
FINAL="$BACKUP_DIR/$NAME"
PARTIAL="$BACKUP_DIR/.${NAME}.partial"
LOG="$(mktemp)"
CIDFILE="$(mktemp -u)"

cleanup() {
  if [[ -s "$CIDFILE" ]]; then
    docker rm -f "$(cat "$CIDFILE")" >/dev/null 2>&1 || true
  fi
  rm -f "$CIDFILE" "$PARTIAL" "$LOG"
}
trap cleanup EXIT
trap 'echo >&2; echo "Interrupted: the dump was stopped and nothing was written." >&2; exit 130' INT
trap 'exit 143' TERM HUP

echo "==> Dumping '$DB' from $URI_HOST"
echo "    into $FINAL"

status=0
docker run --rm --cidfile "$CIDFILE" --network host -e MONGO_URI "$IMAGE" \
  sh -c 'exec mongodump --uri="$MONGO_URI" --archive --gzip' 2>&1 >"$PARTIAL" | redact | tee "$LOG" >&2 || status=$?

if [[ $status -ne 0 ]]; then
  die "mongodump failed (exit $status). Nothing was written."
fi

[[ -s "$PARTIAL" ]] || die "mongodump produced an empty archive. Nothing was written."
gzip -t "$PARTIAL" 2>/dev/null || die "the archive did not survive a gzip integrity check. Nothing was written."

COLLECTIONS="$(grep -c 'done dumping' "$LOG" || true)"
[[ "$COLLECTIONS" -gt 0 ]] ||
  die "mongodump reported 0 collections. Is '$DB' the right database on $URI_HOST? Nothing was written."

DOCUMENTS="$(sed -n 's/.*done dumping .* (\([0-9][0-9]*\) document.*/\1/p' "$LOG" | awk '{s+=$1} END {print s+0}')"

chmod 600 "$PARTIAL"
mv "$PARTIAL" "$FINAL"

echo
echo "==> Backup complete"
echo "    database    $DB ($URI_HOST)"
echo "    collections $COLLECTIONS"
echo "    documents   $DOCUMENTS"
echo "    size        $(du -h "$FINAL" | cut -f1)"
echo "    file        $FINAL"
echo
echo "Restore it with (the server only, no database path):"
echo "    MONGO_URI='<scheme>://<user>:<pass>@$URI_HOST/' npm run db:restore -- '$FINAL'"
