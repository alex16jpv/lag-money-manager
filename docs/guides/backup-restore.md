# Backup and Restore

Two commands take a copy of a live database and put one back:

```bash
MONGO_URI='mongodb+srv://user:pass@cluster.mongodb.net/lag_money' npm run db:backup
MONGO_URI='mongodb+srv://user:pass@cluster.mongodb.net' npm run db:restore -- backups/lag_money-2026-09-16T23-09-10Z.archive.gz
```

Both read `MONGO_URI` **from the environment only, never from `.env`**. That file's
value changes depending on what you were last working on, and a command that can
overwrite a production database must not guess which one it is pointing at.

The database in the URI means something different on each side. For a backup it
is **what to copy**. For a restore it is **where to put it**: leave it out and the
archive goes back into the databases it came from, name it and the archive is
restored into that one instead.

## Requirements

`mongodump` and `mongorestore` are not installed on the host. Both commands run
them inside a throwaway container built from the `mongo:8` image, which you
already have locally for `docker compose up -d mongo`. Nothing is installed, and
the container is removed when the command ends — including when you interrupt
it, which stops the dump or restore rather than leaving it running.

The container runs with `--network host`, so the same command reaches both a
MongoDB Atlas cluster and the local `docker compose` MongoDB on
`localhost:27017`.

## Backup

```bash
MONGO_URI='mongodb+srv://user:pass@cluster.mongodb.net/lag_money' npm run db:backup
```

Archives land in `backups/` **inside this repository**, as
`<database>-<UTC timestamp>.archive.gz`, a single gzipped file — next to the code
you ran the command from, not hidden in a home directory. `backups/` is in
`.gitignore`, the directory is created `700` and each archive `600`.

Override the location with `BACKUP_DIR`. The command refuses a directory that git
would commit: a dump carries real user data, so it may live inside a repository
only while it is ignored.

The command prints the database, the host, the collection and document counts
and the size, and fails rather than leaving a half-written file: the archive is
written to a `.partial` name, checked for gzip integrity and for having dumped
at least one collection, and only then moved into place. Interrupting it removes
the partial file.

### What a backup does not give you

`mongodump` scoped to one database cannot use `--oplog`, so the archive is **not
a point-in-time snapshot**. Collections are read one after another, and a write
that lands between two of them is captured on one side and not the other. In
this product a transfer writes `transactions` and `accounts` inside a single
MongoDB transaction, so a dump taken under load can capture half of one.

For a backup you intend to restore from, take it when nothing is writing.

## Restore

```bash
MONGO_URI='mongodb+srv://user:pass@cluster.mongodb.net' npm run db:restore -- <archive>
```

Note the `--`: without it, npm keeps the argument for itself.

**Without a database in the URI**, the archive goes back into the databases it
was taken from. That is the real recovery case: same names, whichever server you
point at.

**With a database in the URI**, the archive is restored into that database
instead. This is how you check an archive without touching anything real —
restore a production dump into a scratch database on your own machine and look at
it:

```bash
MONGO_URI='mongodb://localhost:27017/lag_money_check' npm run db:restore -- <archive>
```

Renaming only works when the archive carries a single database, which is always
true of an archive `npm run db:backup` produced. If it carries several, the
command says so and asks you to drop the database from the URI.

Before writing anything, the command does a dry run against the server. That
proves the URI and credentials work, and tells it exactly which collections the
archive will write. It then prints them — under their final names, after any
rename — and asks you to confirm **the server host**, showing you which one:

```
Server to overwrite [localhost:27017]:
```

You type that string back. It asks for the host rather than the database name
because the name is the same on your laptop and in production, and so confirms
nothing; the server is what decides whether this is a rehearsal or the real
thing.

**A restore destroys data.** Every collection carried by the archive is dropped
and rewritten in the target. A collection that exists there and is *not* in the
archive is left alone — a restore is not a reset of the whole database. If you
interrupt it, it stops, and says plainly that the target is now half-written and
unusable until you run the restore through to the end.

Afterwards the command reports how many documents were restored, and fails if
any document failed, or if it dropped collections and then restored nothing.

## Keeping the URI out of your shell history

Typing the production URI inline puts the password in your shell history. Keep
it in a file outside all three repositories, as the Sentry credentials already
are:

```bash
install -m 600 /dev/null ~/.config/ledger-flow/prod-uri   # once
MONGO_URI="$(cat ~/.config/ledger-flow/prod-uri)" npm run db:backup
```

The URI reaches the container through its environment rather than on the host
command line, so it does not appear in the host process list. It **is** visible
to anyone who can query the Docker daemon while the command runs — `docker
inspect` shows a container's environment, and `mongodump` inside the container
receives the URI as an argument. Both end when the container is removed, which
is every exit path including an interrupt. Anything the tools print is filtered
first, so a failed connection reports the host and database but not the
password.

## Options

| Variable | Default | What it does |
| --- | --- | --- |
| `MONGO_URI` | *(required)* | Server to act on. For a backup the database is what to copy; for a restore it is where to put it, and may be left out. |
| `BACKUP_DIR` | `<repo>/backups` | Where archives are written. Refuses a directory git would commit. |
| `MONGO_TOOLS_IMAGE` | `mongo:8` | Image providing `mongodump` and `mongorestore`. |

## When something goes wrong

| What you see | What it means |
| --- | --- |
| `mongodump reported 0 collections` | The database in the URI is empty or misspelled. Nothing was written. |
| `the dry run resolved 0 collections` | The archive carries nothing to restore. Nothing was written. |
| `the archive carries several` | You renamed the target, but the archive holds more than one database. Drop the database from the URI. |
| `is not a usable database name` | The URI's path is not a plain database name — often a trailing `/`, or options without a `?`. |
| `server selection error … connection refused` | The server is unreachable. `mongodump` retries for about 30 seconds when the connection is refused outright, and longer when the address simply does not answer. |
| `image 'mongo:8' is not available locally` | `docker pull mongo:8`. |
