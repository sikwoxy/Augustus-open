export type CapabilityProbeCategory =
  | "runtime"
  | "package_manager"
  | "dev_tool"
  | "browser"
  | "container"
  | "document_media"
  | "network"
  | "hardware"
  | "filesystem"
  | "shell";

export type CapabilityProbeStatus =
  | "available"
  | "unavailable"
  | "uncertain"
  | "skipped";

export interface CapabilityProbe {
  id: string;
  category: CapabilityProbeCategory;
  name: string;
  status: CapabilityProbeStatus;
  command?: string;
  path?: string;
  version?: string;
  exitCode?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
  confidence: number;
  capturedAt: number;
  expiresAt?: number;
  evidenceRef: string;
}

export interface HostOSInfo {
  platform: string;
  release: string;
  arch: string;
  homedir: string;
  tmpdir: string;
  pathSeparator: string;
  timezone: string;
  locale: string;
}

export interface HostShellInfo {
  defaultShell: string;
  availableShells: string[];
  powershellVersion?: string;
}

export interface HostNetworkInfo {
  proxyEnv: Record<string, string>;
}

export interface EnvironmentSummaries {
  mainSummary: string;
  subagentSummary: string;
  shellSummary: string;
}

export interface HostEnvironmentPrior {
  id: string;
  hostId: string;
  capturedAt: number;
  expiresAt: number;
  os: HostOSInfo;
  shell: HostShellInfo;
  network: HostNetworkInfo;
  capabilities: CapabilityProbe[];
  summaries: EnvironmentSummaries;
  evidenceRefs: string[];
}
