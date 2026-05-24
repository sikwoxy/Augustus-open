import * as fs from "node:fs";
import * as os from "node:os";
import type { CapabilityProbe, CapabilityProbeCategory } from "./types";
import { executeProbe } from "./probe-runner";

export interface ProbeDefinition {
  id: string;
  category: CapabilityProbeCategory;
  name: string;
  candidates: string[];
  versionArgs: string[];
}

const PROBE_DEFINITIONS: ProbeDefinition[] = [
  // Node ecosystem (Node is assumed present but version must be recorded)
  { id: "node", category: "runtime", name: "node", candidates: ["node"], versionArgs: ["--version"] },
  { id: "npm", category: "package_manager", name: "npm", candidates: ["npm"], versionArgs: ["--version"] },
  { id: "npx", category: "package_manager", name: "npx", candidates: ["npx"], versionArgs: ["--version"] },
  { id: "corepack", category: "package_manager", name: "corepack", candidates: ["corepack"], versionArgs: ["--version"] },

  // Python ecosystem
  { id: "python3", category: "runtime", name: "python3", candidates: ["python3"], versionArgs: ["--version"] },
  { id: "python", category: "runtime", name: "python", candidates: ["python"], versionArgs: ["--version"] },
  { id: "py", category: "runtime", name: "py", candidates: ["py"], versionArgs: ["--version"] },
  { id: "pip", category: "package_manager", name: "pip", candidates: ["pip"], versionArgs: ["--version"] },
  { id: "pip3", category: "package_manager", name: "pip3", candidates: ["pip3"], versionArgs: ["--version"] },
  { id: "conda", category: "package_manager", name: "conda", candidates: ["conda"], versionArgs: ["--version"] },
  { id: "uv", category: "package_manager", name: "uv", candidates: ["uv"], versionArgs: ["--version"] },
  { id: "poetry", category: "package_manager", name: "poetry", candidates: ["poetry"], versionArgs: ["--version"] },

  // Java ecosystem
  { id: "java", category: "runtime", name: "java", candidates: ["java"], versionArgs: ["--version"] },
  { id: "javac", category: "runtime", name: "javac", candidates: ["javac"], versionArgs: ["--version"] },
  { id: "mvn", category: "package_manager", name: "mvn", candidates: ["mvn"], versionArgs: ["--version"] },
  { id: "gradle", category: "package_manager", name: "gradle", candidates: ["gradle"], versionArgs: ["--version"] },

  // Go / Rust / .NET
  { id: "go", category: "runtime", name: "go", candidates: ["go"], versionArgs: ["version"] },
  { id: "rustc", category: "runtime", name: "rustc", candidates: ["rustc"], versionArgs: ["--version"] },
  { id: "cargo", category: "package_manager", name: "cargo", candidates: ["cargo"], versionArgs: ["--version"] },
  { id: "dotnet", category: "runtime", name: "dotnet", candidates: ["dotnet"], versionArgs: ["--version"] },

  // Dev tools
  { id: "git", category: "dev_tool", name: "git", candidates: ["git"], versionArgs: ["--version"] },
  { id: "ssh", category: "dev_tool", name: "ssh", candidates: ["ssh"], versionArgs: ["-V"] },
  { id: "curl", category: "network", name: "curl", candidates: ["curl"], versionArgs: ["--version"] },
  { id: "wget", category: "network", name: "wget", candidates: ["wget"], versionArgs: ["--version"] },
  { id: "rg", category: "dev_tool", name: "rg", candidates: ["rg"], versionArgs: ["--version"] },
  { id: "jq", category: "dev_tool", name: "jq", candidates: ["jq"], versionArgs: ["--version"] },

  // JS package managers
  { id: "pnpm", category: "package_manager", name: "pnpm", candidates: ["pnpm"], versionArgs: ["--version"] },
  { id: "yarn", category: "package_manager", name: "yarn", candidates: ["yarn"], versionArgs: ["--version"] },

  // Containers
  { id: "docker", category: "container", name: "docker", candidates: ["docker"], versionArgs: ["--version"] },
  { id: "podman", category: "container", name: "podman", candidates: ["podman"], versionArgs: ["--version"] },

  // Document / media
  { id: "ffmpeg", category: "document_media", name: "ffmpeg", candidates: ["ffmpeg"], versionArgs: ["-version"] },
  { id: "libreoffice", category: "document_media", name: "libreoffice", candidates: ["libreoffice", "soffice"], versionArgs: ["--version"] },
];

function getBrowserPaths(): { name: string; paths: string[] }[] {
  const isWindows = os.platform() === "win32";
  const isMac = os.platform() === "darwin";

  if (isWindows) {
    return [
      {
        name: "chrome",
        paths: [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        ],
      },
      {
        name: "edge",
        paths: [
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ],
      },
      {
        name: "firefox",
        paths: [
          "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
          "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
        ],
      },
    ];
  }

  if (isMac) {
    return [
      {
        name: "chrome",
        paths: [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ],
      },
      {
        name: "edge",
        paths: [
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ],
      },
      {
        name: "firefox",
        paths: ["/Applications/Firefox.app/Contents/MacOS/firefox"],
      },
    ];
  }

  return [
    { name: "chrome", paths: ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"] },
    { name: "edge", paths: ["/usr/bin/microsoft-edge"] },
    { name: "firefox", paths: ["/usr/bin/firefox"] },
  ];
}

function probeBrowser(
  name: string,
  paths: string[],
  evidenceDate: string,
): CapabilityProbe {
  const capturedAt = Date.now();
  const evidenceRef = `probes/${evidenceDate}.jsonl`;

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return {
        id: `browser-${name}`,
        category: "browser",
        name,
        status: "available",
        path: p,
        confidence: 0.8,
        capturedAt,
        evidenceRef,
      };
    }
  }

  return {
    id: `browser-${name}`,
    category: "browser",
    name,
    status: "unavailable",
    confidence: 0.7,
    capturedAt,
    evidenceRef,
  };
}

export async function runAllProbes(): Promise<CapabilityProbe[]> {
  const dateKey = new Date().toISOString().slice(0, 10);
  const results: CapabilityProbe[] = [];

  for (const def of PROBE_DEFINITIONS) {
    try {
      const probe = await executeProbe(
        def.id,
        def.category,
        def.name,
        def.candidates,
        def.versionArgs,
        dateKey,
      );
      results.push(probe);
    } catch {
      results.push({
        id: def.id,
        category: def.category,
        name: def.name,
        status: "uncertain",
        confidence: 0.3,
        capturedAt: Date.now(),
        evidenceRef: `probes/${dateKey}.jsonl`,
      });
    }
  }

  for (const browser of getBrowserPaths()) {
    try {
      results.push(probeBrowser(browser.name, browser.paths, dateKey));
    } catch {
      results.push({
        id: `browser-${browser.name}`,
        category: "browser",
        name: browser.name,
        status: "uncertain",
        confidence: 0.3,
        capturedAt: Date.now(),
        evidenceRef: `probes/${dateKey}.jsonl`,
      });
    }
  }

  return results;
}
