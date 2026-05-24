import type { LoadedSkill } from "./types";

/**
 * 将 enabled skill 列表格式化为可注入 system prompt 的简短摘要。
 * 每个 skill 最多包含 id/title/description/triggers/requiredTools/preferredAgents。
 */
export function formatSkillsForPrompt(skills: LoadedSkill[]): string {
  const enabled = skills.filter((s) => s.manifest.enabled !== false);
  if (enabled.length === 0) return "";

  const lines: string[] = ["", "## Available Skills", ""];

  for (const skill of enabled) {
    const m = skill.manifest;

    lines.push(`### ${m.id}`);
    lines.push(`- **描述**: ${m.title} — ${m.description}`);

    if (m.triggers && m.triggers.length > 0) {
      lines.push(`- **触发场景**: ${m.triggers.join(", ")}`);
    }

    if (m.requiredTools && m.requiredTools.length > 0) {
      lines.push(`- **所需工具**: ${m.requiredTools.join(", ")}`);
    }

    if (m.preferredAgents && m.preferredAgents.length > 0) {
      lines.push(`- **推荐 Agent**: ${m.preferredAgents.join(", ")}`);
    }

    if (m.kind) {
      lines.push(`- **类型**: ${m.kind}`);
    }

    lines.push("");
  }

  lines.push("上述技能仅表示系统具备的能力领域，不自动赋予工具权限。");

  return lines.join("\n");
}
