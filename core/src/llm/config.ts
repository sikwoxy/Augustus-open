import process from "node:process";
import type { LLMConfig } from "./types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Set it in your environment before running examples.`);
  }
  return value;
}

export const defaultConfig: LLMConfig = {
  baseURL: process.env.LLM_BASE_URL || "",
  apiKey: requireEnv("LLM_API_KEY"),
  model: process.env.LLM_MODEL || "kimi-k2.5",
  maxTokens: 4096,
  temperature: 0.7,
};

export function createConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return { ...defaultConfig, ...overrides };
}
