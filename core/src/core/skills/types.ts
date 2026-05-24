// ═══════════════════════════════════════════════
// Skills 模块类型定义
//
// Skill 是可复用能力包/工作流说明，不是 Runtime、
// 不是 Agent、不是 Tool、不是模型路由。
// Skill 只影响 prompt 内容，不改变 allowedTools，
// 不直接执行工具。
// ═══════════════════════════════════════════════

export type SkillKind =
  | "workflow"
  | "domain"
  | "conversion"
  | "integration"
  | "verification";

export type SkillPermission = "read" | "write" | "execute" | "network";

export interface SkillManifest {
  id: string;
  title: string;
  description: string;
  version?: string;
  enabled?: boolean;
  kind?: SkillKind;
  triggers?: string[];
  agentHints?: string[];
  preferredAgents?: string[];
  inputs?: string[];
  outputs?: string[];
  requiredCapabilities?: string[];
  requiredTools?: string[];
  optionalTools?: string[];
  permissions?: SkillPermission[];
  instructionFile?: string;
  qualityChecklist?: string[];
  failureModes?: string[];
}

export interface LoadedSkill {
  manifest: SkillManifest;
  instructions?: string;
  sourceDir: string;
}

export interface LoadDiagnostic {
  skillDir: string;
  level: "warning" | "error";
  message: string;
}
