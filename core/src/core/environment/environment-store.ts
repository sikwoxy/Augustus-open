import * as fs from "node:fs";
import * as path from "node:path";
import type { HostEnvironmentPrior, CapabilityProbe } from "./types";

const ENV_DIR = ".augustus/environment";
const PRIOR_FILE = "host-prior.json";
const PROBES_DIR = "probes";

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getEnvDir(projectRoot?: string): string {
  return path.resolve(projectRoot ?? process.cwd(), ENV_DIR);
}

export function savePrior(prior: HostEnvironmentPrior, projectRoot?: string): string {
  const envDir = getEnvDir(projectRoot);
  ensureDir(envDir);
  const filePath = path.join(envDir, PRIOR_FILE);
  fs.writeFileSync(filePath, JSON.stringify(prior, null, 2), "utf-8");
  return filePath;
}

export function loadLatestPrior(projectRoot?: string): HostEnvironmentPrior | null {
  const filePath = path.join(getEnvDir(projectRoot), PRIOR_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as HostEnvironmentPrior;
  } catch {
    return null;
  }
}

export function appendProbeRecords(probes: CapabilityProbe[], projectRoot?: string): string {
  const probesDir = path.join(getEnvDir(projectRoot), PROBES_DIR);
  ensureDir(probesDir);
  const dateKey = new Date().toISOString().slice(0, 10);
  const filePath = path.join(probesDir, `${dateKey}.jsonl`);
  const lines = probes.map((p) => JSON.stringify(p)).join("\n") + "\n";
  fs.appendFileSync(filePath, lines, "utf-8");
  return filePath;
}
