import { createArtifactTools } from "./artifact-tools";
import { createCommandTools } from "./command-tools";
import { createDelegateTools } from "./delegate-tools";
import { createExperienceTools } from "./experience-tools";
import { createMemoryTools } from "./memory-tools";
import { createProjectReadTools } from "./project-read-tools";
import type { RegisteredTool, ToolRegistry } from "./registry";
import { createTaskTools } from "./task-tools";
import { FileSystemToolAuditStore, withToolAudit } from "./tool-audit";
import type { ToolRuntimeContext } from "./tool-context";
import { createWebTools } from "./web-tools";

export function registerDefaultTools(registry: ToolRegistry, context: ToolRuntimeContext): void {
  const auditStore = new FileSystemToolAuditStore(context.dataDir);
  auditStore.init();
  const register = (tool: RegisteredTool) => {
    registry.register(withToolAudit(tool, auditStore, () => {
      const current = context.getCurrentContext?.();
      return current
        ? { sessionId: `${current.channel}:${current.conversationId}` }
        : undefined;
    }));
  };

  for (const tool of createWebTools(context)) register(tool);
  for (const tool of createArtifactTools(context)) register(tool);
  for (const tool of createTaskTools(context)) register(tool);
  for (const tool of createMemoryTools(context)) register(tool);
  for (const tool of createDelegateTools(context)) register(tool);
  for (const tool of createProjectReadTools(context)) {
    register(tool);
  }
  for (const tool of createCommandTools(context)) {
    register(tool);
  }
  for (const tool of createExperienceTools({
    dataDir: context.dataDir,
    projectRoot: context.projectRoot,
    auditStore,
  })) {
    register(tool);
  }
}
