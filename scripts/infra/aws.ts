import { spawnSync } from "child_process";
import { parse as parseEnv } from "dotenv";
import { existsSync, readFileSync } from "fs";
import path from "path";

export const REPO = path.resolve(__dirname, "../..");

export type DeploySettings = { profile: string; region: string };

export function deploySettings(
  profileKey: "AWS_PROFILE" | "INFRA_AWS_PROFILE",
): DeploySettings {
  const file = path.join(REPO, ".env.deploy");
  const values = {
    ...(existsSync(file) ? parseEnv(readFileSync(file)) : {}),
    ...process.env,
  };
  const profile = values[profileKey];
  const region = values.AWS_REGION;
  if (!profile || !region) {
    throw new Error(
      `Set ${profileKey} and AWS_REGION in .env.deploy (see .env.deploy.example).`,
    );
  }
  return { profile, region };
}

export class AwsError extends Error {
  get notFound(): boolean {
    return /does not exist|NotFound|NoSuchEntity/.test(this.message);
  }
}

export function aws(
  settings: DeploySettings,
  args: string[],
  input?: string,
): Record<string, unknown> {
  const result = spawnSync(
    "aws",
    [
      ...args,
      "--profile",
      settings.profile,
      "--region",
      settings.region,
      "--output",
      "json",
      "--no-cli-pager",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, input },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new AwsError(
      `aws ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim()}`,
    );
  }
  const out = result.stdout.trim();
  return out ? (JSON.parse(out) as Record<string, unknown>) : {};
}

export type Identity = { Arn: string; Account: string };

export function ensureSession(settings: DeploySettings): Identity {
  const identity = (): Identity =>
    aws(settings, ["sts", "get-caller-identity"]) as Identity;
  let noSession: unknown;
  try {
    return identity();
  } catch (err) {
    noSession = err;
  }
  const signsInByBrowser =
    spawnSync("aws", [
      "configure",
      "get",
      "login_session",
      "--profile",
      settings.profile,
    ]).status === 0;
  if (!signsInByBrowser) throw noSession;
  console.log(
    `==> No session for profile ${settings.profile}; starting aws login`,
  );
  const login = spawnSync("aws", ["login", "--profile", settings.profile], {
    stdio: "inherit",
  });
  if (login.status !== 0) {
    throw new Error(`aws login --profile ${settings.profile} failed.`);
  }
  return identity();
}
