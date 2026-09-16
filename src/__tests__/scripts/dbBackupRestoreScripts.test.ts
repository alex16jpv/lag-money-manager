import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const SCRIPTS = path.resolve(__dirname, "../../../scripts");
const BACKUP = path.join(SCRIPTS, "db-backup.sh");
const RESTORE = path.join(SCRIPTS, "db-restore.sh");

type Run = { status: number; output: string };

function run(script: string, args: string[], env: NodeJS.ProcessEnv): Run {
  try {
    const stdout = execFileSync("bash", [script, ...args], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

describe("db-backup.sh", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "t84-backup-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to run without MONGO_URI", () => {
    const { status, output } = run(BACKUP, [], { BACKUP_DIR: dir });
    expect(status).not.toBe(0);
    expect(output).toContain("MONGO_URI is not set");
  });

  it("refuses a URI that is not a MongoDB URI", () => {
    const { status, output } = run(BACKUP, [], {
      BACKUP_DIR: dir,
      MONGO_URI: "postgres://user@host/db",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("must start with mongodb://");
  });

  it("refuses a URI that names no database, so a dump is always scoped", () => {
    const { status, output } = run(BACKUP, [], {
      BACKUP_DIR: dir,
      MONGO_URI: "mongodb://localhost:27017",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("names no database");
  });

  it("refuses a path that is not a plain database name", () => {
    const { status, output } = run(BACKUP, [], {
      BACKUP_DIR: dir,
      MONGO_URI: "mongodb://localhost:27017/lag_money/?replicaSet=rs0",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("is not a usable database name");
  });

  it("refuses a database name that would escape the backup directory", () => {
    const { status, output } = run(BACKUP, [], {
      BACKUP_DIR: dir,
      MONGO_URI: "mongodb://localhost:27017/../escape",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("is not a usable database name");
  });

  it("refuses stray arguments instead of ignoring them", () => {
    const { status, output } = run(BACKUP, ["/somewhere/else"], {
      BACKUP_DIR: dir,
      MONGO_URI: "mongodb://localhost:27017/lag_money",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("takes no arguments");
  });

  it("refuses a backup directory inside a git repository", () => {
    const { status, output } = run(BACKUP, [], {
      BACKUP_DIR: path.resolve(__dirname, "../../../.t84-guard"),
      MONGO_URI: "mongodb://localhost:27017/lag_money",
    });
    rmSync(path.resolve(__dirname, "../../../.t84-guard"), {
      recursive: true,
      force: true,
    });
    expect(status).not.toBe(0);
    expect(output).toContain("inside a git repository");
  });

  it("prints usage on --help without touching anything", () => {
    const { status, output } = run(BACKUP, ["--help"], {});
    expect(status).toBe(0);
    expect(output).toContain("npm run db:backup");
  });
});

describe("db-restore.sh", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "t84-restore-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses when no archive is given", () => {
    const { status, output } = run(RESTORE, [], {
      MONGO_URI: "mongodb://localhost:27017",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("No archive given");
  });

  it("refuses an archive that does not exist", () => {
    const { status, output } = run(RESTORE, [path.join(dir, "nope.gz")], {
      MONGO_URI: "mongodb://localhost:27017",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("Archive not found");
  });

  it("refuses an archive that fails its integrity check", () => {
    const broken = path.join(dir, "broken.archive.gz");
    writeFileSync(broken, "this is not a gzip stream");
    const { status, output } = run(RESTORE, [broken], {
      MONGO_URI: "mongodb://localhost:27017",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("gzip integrity check");
  });

  it("refuses to run without a terminal, because it asks for confirmation", () => {
    const archive = path.join(dir, "ok.archive.gz");
    writeFileSync(archive, gzipSync(Buffer.from("payload")));
    const { status, output } = run(RESTORE, [archive], {
      MONGO_URI: "mongodb://localhost:27017",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("run it from a terminal");
  });

  it("refuses a URI that names a database, which would filter the archive", () => {
    const archive = path.join(dir, "ok.archive.gz");
    writeFileSync(archive, gzipSync(Buffer.from("payload")));
    const { status, output } = run(RESTORE, [archive], {
      MONGO_URI: "mongodb://localhost:27017/lag_money",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("names a database");
  });

  it("refuses more than one argument", () => {
    const { status, output } = run(RESTORE, ["one", "two"], {
      MONGO_URI: "mongodb://localhost:27017",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("exactly one argument");
  });

  it("prints usage on --help without touching anything", () => {
    const { status, output } = run(RESTORE, ["--help"], {});
    expect(status).toBe(0);
    expect(output).toContain("npm run db:restore");
  });
});
