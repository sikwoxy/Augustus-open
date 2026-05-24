import { createHash } from "node:crypto";
import * as os from "node:os";
import { collectOSInfo, collectShellInfo, sanitizeProxyEnv } from "./probe-runner";
import { runAllProbes } from "./probes";
import { generateSummaries } from "./summary";
import type { HostEnvironmentPrior } from "./types";

export type {
  CapabilityProbeCategory,
  CapabilityProbeStatus,
  CapabilityProbe,
  HostOSInfo,
  HostShellInfo,
  HostNetworkInfo,
  EnvironmentSummaries,
  HostEnvironmentPrior,
} from "./types";

export { executeProbe, collectOSInfo, collectShellInfo, sanitizeProxyEnv } from "./probe-runner";
export { runAllProbes } from "./probes";
export { savePrior, loadLatestPrior, appendProbeRecords } from "./environment-store";
export { generateSummaries } from "./summary";

function generateHostId(): string {
  return createHash("sha256")
    .update(`${os.hostname()}:${os.homedir()}`)
    .digest("hex")
    .slice(0, 16);
}

function generatePriorId(): string {
  return `prior_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function captureEnvironmentPrior(): Promise<HostEnvironmentPrior> {
  const capturedAt = Date.now();
  const hostId = generateHostId();

  const osInfo = collectOSInfo();
  const shellInfo = await collectShellInfo();
  const capabilities = await runAllProbes();
  const proxyEnv = sanitizeProxyEnv();

  const evidenceRefs: string[] = [];
  const dateKey = new Date().toISOString().slice(0, 10);
  evidenceRefs.push(`probes/${dateKey}.jsonl`);

  for (const key of Object.keys(proxyEnv)) {
    evidenceRefs.push(`proxy:${key}`);
  }

  const prior: HostEnvironmentPrior = {
    id: generatePriorId(),
    hostId,
    capturedAt,
    // expire after 7 days
    expiresAt: capturedAt + 7 * 24 * 60 * 60 * 1000,
    os: osInfo,
    shell: shellInfo,
    network: {
      proxyEnv,
    },
    capabilities,
    summaries: { mainSummary: "", subagentSummary: "", shellSummary: "" },
    evidenceRefs,
  };

  prior.summaries = generateSummaries(prior);

  prior.capabilities.forEach((cap) => {
    if (cap.command && !cap.path) {
      cap.path = cap.command;
    }
  });

  return prior;
}
