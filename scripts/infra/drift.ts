import { setTimeout as sleep } from "timers/promises";

import { aws, type DeploySettings } from "./aws";

export type ResourceDrift = {
  LogicalResourceId: string;
  ResourceType: string;
  StackResourceDriftStatus: string;
  PropertyDifferences?: { PropertyPath: string; DifferenceType: string }[];
};

export type DriftReport = { drifted: string[]; notCompared: string[] };

export function readDrifts(drifts: ResourceDrift[]): DriftReport {
  const name = (drift: ResourceDrift): string =>
    `${drift.LogicalResourceId} (${drift.ResourceType})`;
  return {
    drifted: drifts
      .filter(({ StackResourceDriftStatus: status }) =>
        ["MODIFIED", "DELETED"].includes(status),
      )
      .map((drift) => {
        const paths = (drift.PropertyDifferences ?? []).map(
          (d) => `${d.PropertyPath} ${d.DifferenceType.toLowerCase()}`,
        );
        return `${name(drift)} ${drift.StackResourceDriftStatus.toLowerCase()}${paths.length ? `: ${paths.join(", ")}` : ""}`;
      }),
    notCompared: drifts
      .filter(({ StackResourceDriftStatus: status }) =>
        ["NOT_CHECKED", "UNKNOWN"].includes(status),
      )
      .map(name),
  };
}

const DETECTION_LIMIT_MS = 5 * 60 * 1000;

export async function detectDrift(
  settings: DeploySettings,
  stack: string,
): Promise<DriftReport> {
  const { StackDriftDetectionId: id } = aws(settings, [
    "cloudformation",
    "detect-stack-drift",
    "--stack-name",
    stack,
  ]) as { StackDriftDetectionId: string };
  const deadline = Date.now() + DETECTION_LIMIT_MS;
  for (;;) {
    const status = aws(settings, [
      "cloudformation",
      "describe-stack-drift-detection-status",
      "--stack-drift-detection-id",
      id,
    ]) as { DetectionStatus: string; DetectionStatusReason?: string };
    if (status.DetectionStatus === "DETECTION_FAILED") {
      throw new Error(
        `drift detection failed: ${status.DetectionStatusReason}`,
      );
    }
    if (status.DetectionStatus === "DETECTION_COMPLETE") break;
    if (Date.now() > deadline)
      throw new Error("drift detection took over 5 minutes");
    await sleep(3000);
  }
  const { StackResourceDrifts } = aws(settings, [
    "cloudformation",
    "describe-stack-resource-drifts",
    "--stack-name",
    stack,
  ]) as { StackResourceDrifts: ResourceDrift[] };
  return readDrifts(StackResourceDrifts);
}
