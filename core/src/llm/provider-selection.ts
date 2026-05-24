export type LLMProviderProtocol = "anthropic" | "openai";

export function normalizeProvider(value: string | undefined | null): LLMProviderProtocol | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "openai") return normalized;
  return undefined;
}

export function inferProviderFromConfig(
  baseURL: string | undefined = process.env.LLM_BASE_URL,
  model: string | undefined = process.env.LLM_MODEL,
): LLMProviderProtocol {
  const url = baseURL?.trim().toLowerCase() ?? "";
  const modelName = model?.trim().toLowerCase() ?? "";

  if (url.includes("anthropic.com")) return "anthropic";
  if (/\/v1\/?$/.test(url)) return "openai";
  if (modelName.startsWith("gpt-") || modelName.startsWith("deepseek-")) return "openai";
  if (modelName.startsWith("claude-")) return "anthropic";

  return "anthropic";
}

export function resolveProviderFromEnv(envName?: string): LLMProviderProtocol {
  return (
    normalizeProvider(envName ? process.env[envName] : undefined) ??
    normalizeProvider(process.env.AUGUSTUS_PROVIDER) ??
    normalizeProvider(process.env.LLM_PROVIDER) ??
    inferProviderFromConfig()
  );
}
