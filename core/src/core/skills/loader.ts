import * as fs from "node:fs";
import * as path from "node:path";
import type { LoadedSkill, LoadDiagnostic, SkillManifest } from "./types";

const DEFAULT_INSTRUCTION_FILE = "SKILL.md";
const ID_RE = /^[a-z0-9_-]+$/;

export interface LoadResult {
  skills: LoadedSkill[];
  diagnostics: LoadDiagnostic[];
}

/**
 * 从 {projectRoot}/skills 加载所有 skill。
 * 单个 skill 加载失败时跳过，不抛异常。
 */
export function loadSkills(projectRoot: string): LoadResult {
  const skillsDir = path.join(projectRoot, "skills");
  const skills: LoadedSkill[] = [];
  const diagnostics: LoadDiagnostic[] = [];

  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    return { skills, diagnostics };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (err) {
    diagnostics.push({
      skillDir: skillsDir,
      level: "error",
      message: `无法读取 skills 目录: ${String(err)}`,
    });
    return { skills, diagnostics };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const result = loadSingleSkill(skillDir);
    if (result.skill) {
      skills.push(result.skill);
    }
    if (result.diagnostic) {
      diagnostics.push(result.diagnostic);
    }
  }

  return { skills, diagnostics };
}

function loadSingleSkill(skillDir: string): {
  skill?: LoadedSkill;
  diagnostic?: LoadDiagnostic;
} {
  const manifestPath = path.join(skillDir, "skill.json");

  if (!fs.existsSync(manifestPath)) {
    return {
      diagnostic: {
        skillDir,
        level: "warning",
        message: `缺少 skill.json，跳过`,
      },
    };
  }

  let manifest: SkillManifest;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as SkillManifest;
    manifest = validateManifest(raw, skillDir);
  } catch (err) {
    return {
      diagnostic: {
        skillDir,
        level: "warning",
        message: `skill.json 解析或校验失败: ${String(err)}`,
      },
    };
  }

  if (manifest.enabled === false) {
    return {
      diagnostic: {
        skillDir,
        level: "warning",
        message: `skill "${manifest.id}" 已禁用`,
      },
    };
  }

  const instructionFile = manifest.instructionFile ?? DEFAULT_INSTRUCTION_FILE;
  let instructions: string | undefined;

  // 安全检查：instructionFile 不允许越出 skill 目录
  const resolvedInstructionPath = path.resolve(skillDir, instructionFile);
  if (!resolvedInstructionPath.startsWith(path.resolve(skillDir) + path.sep)) {
    return {
      diagnostic: {
        skillDir,
        level: "warning",
        message: `instructionFile "${instructionFile}" 越出 skill 目录，跳过`,
      },
    };
  }

  if (fs.existsSync(resolvedInstructionPath)) {
    try {
      instructions = fs.readFileSync(resolvedInstructionPath, "utf-8");
    } catch (err) {
      return {
        diagnostic: {
          skillDir,
          level: "warning",
          message: `无法读取 instructionFile "${instructionFile}": ${String(err)}`,
        },
      };
    }
  }

  return {
    skill: {
      manifest,
      instructions,
      sourceDir: skillDir,
    },
  };
}

function validateManifest(raw: SkillManifest, skillDir: string): SkillManifest {
  if (!raw.id || typeof raw.id !== "string") {
    throw new Error("id 为必填字符串");
  }

  if (!ID_RE.test(raw.id)) {
    throw new Error(`id "${raw.id}" 格式无效，只允许小写字母、数字、下划线和短横线`);
  }

  if (!raw.title || typeof raw.title !== "string") {
    throw new Error("title 为必填字符串");
  }

  if (!raw.description || typeof raw.description !== "string") {
    throw new Error("description 为必填字符串");
  }

  return raw;
}
