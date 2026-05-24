import type { HostEnvironmentPrior, CapabilityProbe } from "./types";

function probeAvailable(probes: CapabilityProbe[], name: string): boolean {
  return probes.some((p) => p.name === name && p.status === "available");
}

function probeVersion(probes: CapabilityProbe[], name: string): string | undefined {
  return probes.find((p) => p.name === name && p.status === "available")?.version;
}

function collectAvailable(probes: CapabilityProbe[], category: string): string[] {
  return probes
    .filter((p) => p.category === category && p.status === "available")
    .map((p) => (p.version ? `${p.name} ${p.version}` : p.name));
}

function collectAllCategory(probes: CapabilityProbe[], category: string): Array<{ name: string; version?: string; status: string }> {
  return probes
    .filter((p) => p.category === category)
    .map((p) => ({ name: p.name, version: p.version, status: p.status }));
}

function buildMainSummary(prior: HostEnvironmentPrior): string {
  const { os, shell, network, capabilities } = prior;
  const lines: string[] = [];

  lines.push(`OS: ${os.platform} ${os.release} (${os.arch})`);
  lines.push(`Shell: ${shell.defaultShell}${shell.powershellVersion ? ` (PowerShell ${shell.powershellVersion})` : ""}`);
  lines.push(`Timezone: ${os.timezone}`);

  const runtimes = collectAvailable(capabilities, "runtime");
  lines.push(`Runtimes: ${runtimes.length > 0 ? runtimes.join(", ") : "node only"}`);

  const pkgMgrs = collectAvailable(capabilities, "package_manager");
  lines.push(`Package managers: ${pkgMgrs.length > 0 ? pkgMgrs.join(", ") : "npm only"}`);

  const containers = collectAvailable(capabilities, "container");
  lines.push(`Containers: ${containers.length > 0 ? containers.join(", ") : "none"}`);

  const browsers = collectAvailable(capabilities, "browser");
  lines.push(`Browsers: ${browsers.length > 0 ? browsers.join(", ") : "none"}`);

  const proxyVars = Object.keys(network.proxyEnv);
  if (proxyVars.length > 0) {
    lines.push("Network proxy: configured (see shellSummary for details)");
  } else {
    lines.push("Network proxy: not detected");
  }

  const gitAvail = probeAvailable(capabilities, "git");
  lines.push(`Git: ${gitAvail ? "available" : "not available"}`);

  return lines.join("\n");
}

function buildSubagentSummary(prior: HostEnvironmentPrior): string {
  const { os, shell, capabilities } = prior;
  const lines: string[] = [];

  lines.push(`Platform: ${os.platform} ${os.release} ${os.arch}`);
  lines.push(`Shell: ${shell.defaultShell} (available: ${shell.availableShells.join(", ")})`);
  if (shell.powershellVersion) {
    lines.push(`PowerShell: ${shell.powershellVersion}`);
  }

  const runtimes = collectAllCategory(capabilities, "runtime");
  lines.push(`Runtimes: ${runtimes.map((r) => `${r.name}${r.version ? " " + r.version : ""} (${r.status})`).join(", ")}`);

  const pkgMgrs = collectAllCategory(capabilities, "package_manager");
  lines.push(`Package managers: ${pkgMgrs.map((p) => `${p.name}${p.version ? " " + p.version : ""} (${p.status})`).join(", ")}`);

  const devTools = collectAllCategory(capabilities, "dev_tool");
  lines.push(`Dev tools: ${devTools.map((d) => `${d.name} (${d.status})`).join(", ")}`);

  const containers = collectAvailable(capabilities, "container");
  lines.push(`Containers: ${containers.length > 0 ? containers.join(", ") : "none"}`);

  const network = collectAllCategory(capabilities, "network");
  lines.push(`Network tools: ${network.map((n) => `${n.name} (${n.status})`).join(", ")}`);

  const docMedia = collectAllCategory(capabilities, "document_media");
  if (docMedia.length > 0) {
    lines.push(`Document/media: ${docMedia.map((d) => `${d.name} (${d.status})`).join(", ")}`);
  }

  return lines.join("\n");
}

function buildShellSummary(prior: HostEnvironmentPrior): string {
  const { os, shell, network, capabilities } = prior;
  const lines: string[] = [];

  lines.push(`OS: ${os.platform} ${os.release}`);
  lines.push(`Default shell: ${shell.defaultShell}`);
  lines.push(`Available shells: ${shell.availableShells.join(", ")}`);
  if (shell.powershellVersion) {
    lines.push(`PowerShell version: ${shell.powershellVersion}`);
  }
  lines.push(`Home: ${os.homedir}`);
  lines.push(`Tmp: ${os.tmpdir}`);
  lines.push(`Path separator: "${os.pathSeparator}"`);
  lines.push(`Locale: ${os.locale}`);

  const availableTools = capabilities
    .filter((p) => p.status === "available")
    .map((p) => (p.path ? `${p.name}: ${p.path}` : p.name));
  lines.push(`PATH tools (${availableTools.length}): ${availableTools.join(", ")}`);

  const proxyVars = Object.keys(network.proxyEnv);
  if (proxyVars.length > 0) {
    lines.push(`Proxy env vars: ${proxyVars.map((key) => `${key}=${network.proxyEnv[key]}`).join(", ")}`);
  }

  lines.push(`Platform notes: ${os.platform === "win32" ? "Windows — use cmd /c or powershell -Command for shell execution; .cmd/.ps1 wrappers for npm global tools" : "Unix — POSIX shell syntax; use which/command -v for discovery"}`);

  return lines.join("\n");
}

export function generateSummaries(prior: HostEnvironmentPrior) {
  return {
    mainSummary: buildMainSummary(prior),
    subagentSummary: buildSubagentSummary(prior),
    shellSummary: buildShellSummary(prior),
  };
}
