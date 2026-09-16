# Backup and Restore

Two commands take a copy of a live database and put one back:

```bash
MONGO_URI='mongodb+srv://user:pass@cluster.mongodb.net/lag_money' npm run db:backup
MONGO_URI='mongodb://cluster.mongodb.net' npm run db:restore -- ~/ledger-flow-backups/lag_money-2026-09-16T23-09-10Z.archive.gz
```

Both read `MONGO_URI` **from the environment only, never from `.env`**. That file's
value changes depending on what you were last working on, and a command that can
overwrite a production database must never guess which one it is pointing at.

## Requirements

`mongodump` and `mongorestore` are not installed on the host. Both commands run
them inside a throwaway container built from the `mongo:8` image, which you
already have locally for `docker compose up -d mongo`. Nothing is installed and
no container is left behind.

The container runs with `--network host`, so the same command reaches both a
MongoDB Atlas cluster and the local `docker compose` MongoDB on
`localhost:27017`.

## Backup

```bash
MONGO_URI='mongodb+srv://user:pass@cluster.mongodb.net/lag_money' npm run db:backup
```

The URI **must name a database**: the dump is scoped to it, so there is no way
to take a copy without having said out loud what you are copying.

Archives land in `~/ledger-flow-backups` as
`<database>-<UTC timestamp>.archive.gz`, a single gzipped file. The directory is
created `700` and each archive `600`. Override the location with `BACKUP_DIR`;
the command refuses a directory inside a git repository, because a dump carries
real user data.

The command prints the database, the host, the collection and document counts
and the size, and fails rather than leaving a half-written file: the archive is
written to a `.partial` name, checked for gzip integrity and for having dumped
at least one collection, and only then moved into place. Interrupting it with
Ctrl-C removes the partial file.

## Restore

```bash
MONGO_URI='mongodb://cluster.mongodb.net' npm run db:restore -- <archive>
```

Note the `--`: without it, npm keeps the argument for itself.

**Give the server, with no database path.** An archive carries the database
names it was taken from, and restores into them. A path in the URI is read by
`mongorestore` as a filter on the archive's own namespaces, so it matches
nothing and restores nothing while reporting success — the command refuses to
run in that case rather than let that happen quietly.

Before writing anything, the command does a dry run against the server. That
proves the URI and credentials work, and tells it exactly which collections the
archive will write. It then prints them and asks you to type the database names
back before it does anything.

**A restore destroys data.** Every collection carried by the archive is dropped
and rewritten. A collection that exists on the server and is *not* in the
archive is left alone — a restore is not a reset of the whole database.

Afterwards the command reports how many documents were restored, and fails if
any document failed. Restoring into the local MongoDB first, and looking at the
result, costs one command and is the way to check an archive is what you think
it is:

```bash
MONGO_URI='mongodb://localhost:27017' npm run db:restore -- <archive>
```

## Keeping the URI out of your shell history

Typing the production URI inline puts the password in your shell history and, for
as long as the command runs, in the host process list. Keep it in a file outside
all three repositories, as the Sentry credentials already are:

```bash
install -m 600 /dev/null ~/.config/ledger-flow/prod-uri   # once
MONGO_URI="$(cat ~/.config/ledger-flow/prod-uri)" npm run db:backup
```

The URI reaches the container through the environment, never as a command-line
argument, so it does not appear in the process list on either side.

## Options

| Variable | Default | What it does |
| --- | --- | --- |
| `MONGO_URI` | *(required)* | Server to act on. Backup needs a database in the path; restore refuses one. |
| `BACKUP_DIR` | `~/ledger-flow-backups` | Where archives are written. Refuses a directory inside git. |
| `MONGO_TOOLS_IMAGE` | `mongo:8` | Image providing `mongodump` and `mongorestore`. |

## When something goes wrong

| What you see | What it means |
| --- | --- |
| `mongodump reported 0 collections` | The database in the URI is empty or misspelled. Nothing was written. |
| `the dry run resolved 0 collections` | The restore URI carries a database path. Pass the server alone. |
| `server selection error … connection refused` | The server is unreachable. `mongodump` retries for 30 seconds before saying so. |
| `image 'mongo:8' is not available locally` | `docker pull mongo:8`. |
