// ═══════════════════════════════════════════════
// Provider Factory
//
// 第一版：根据 AgentProfile 上的 provider / model 配置
// 创建对应的 LLMAdapter 实例。
//
// 不做动态 Model Router——provider 和 model 直接从
// AgentProfile 读取，由调用方在构造 profile 时决定。
// ═══════════════════════════════════════════════

import type { LLMAdapter } from "./adapter";
import { createConfig } from "./config";
import { OpenAIAdapter } from "./adapters/openai";
import { AnthropicAdapter } from "./adapters/anthropic";
import type { AgentProfile } from "../core/agents/types";

export function createAdapterForProfile(profile: AgentProfile): LLMAdapter {
  const apiKeyEnv = profile.apiKeyEnv ?? "LLM_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `缺少 API Key: AgentProfile "${profile.type}" 要求环境变量 ${apiKeyEnv}，但未设置。`,
    );
  }

  const config = createConfig({
    baseURL: profile.baseURL ?? process.env.LLM_BASE_URL,
    apiKey,
    model: profile.model,
    maxTokens: profile.maxTokens,
    temperature: profile.temperature,
  });

  if (profile.provider === "anthropic") {
    return new AnthropicAdapter(config, { webSearchMaxUses: 3 });
  }

  return new OpenAIAdapter(config);
}
