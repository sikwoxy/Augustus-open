import type { LoadedSkill, LoadDiagnostic } from "./types";

export class SkillRegistry {
  private skills = new Map<string, LoadedSkill>();
  private warnings: LoadDiagnostic[] = [];

  register(skill: LoadedSkill): void {
    const existing = this.skills.get(skill.manifest.id);
    if (existing) {
      this.warnings.push({
        skillDir: skill.sourceDir,
        level: "warning",
        message: `重复 id "${skill.manifest.id}"，后注册覆盖前注册`,
      });
    }
    this.skills.set(skill.manifest.id, skill);
  }

  get(id: string): LoadedSkill | undefined {
    return this.skills.get(id);
  }

  list(): LoadedSkill[] {
    return Array.from(this.skills.values());
  }

  listEnabled(): LoadedSkill[] {
    return Array.from(this.skills.values()).filter(
      (s) => s.manifest.enabled !== false,
    );
  }

  getWarnings(): LoadDiagnostic[] {
    return [...this.warnings];
  }

  clearWarnings(): void {
    this.warnings = [];
  }
}
