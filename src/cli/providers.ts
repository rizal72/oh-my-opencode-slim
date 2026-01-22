import type { InstallConfig } from "./types"
import { DEFAULT_AGENT_SKILLS } from "../tools/skill/builtin"

/**
 * Provider configurations for Google models (via Antigravity auth plugin)
 */
export const GOOGLE_PROVIDER_CONFIG = {
  google: {
    name: "Google",
    models: {
      "gemini-3-pro-high": {
        name: "Gemini 3 Pro High",
        thinking: true,
        attachment: true,
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "gemini-3-flash": {
        name: "Gemini 3 Flash",
        attachment: true,
        limit: { context: 1048576, output: 65536 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "claude-opus-4-5-thinking": {
        name: "Claude Opus 4.5 Thinking",
        attachment: true,
        limit: { context: 200000, output: 32000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      "claude-sonnet-4-5-thinking": {
        name: "Claude Sonnet 4.5 Thinking",
        attachment: true,
        limit: { context: 200000, output: 32000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
    },
  },
}

// Model mappings by provider priority
export const MODEL_MAPPINGS = {
  antigravity: {
    orchestrator: "google/claude-opus-4-5-thinking",
    oracle: "google/claude-opus-4-5-thinking",
    librarian: "google/gemini-3-flash",
    explorer: "google/gemini-3-flash",
    designer: "google/gemini-3-flash",
    fixer: "google/gemini-3-flash",
  },
  openai: {
    orchestrator: "openai/gpt-5.2-codex",
    oracle: "openai/gpt-5.2-codex",
    librarian: "openai/gpt-5.1-codex-mini",
    explorer: "openai/gpt-5.1-codex-mini",
    designer: "openai/gpt-5.1-codex-mini",
    fixer: "openai/gpt-5.1-codex-mini",
  },
  "zen-free": {
    orchestrator: "opencode/glm-4.7-free",
    oracle: "opencode/glm-4.7-free",
    librarian: "opencode/grok-code",
    explorer: "opencode/grok-code",
    designer: "opencode/grok-code",
    fixer: "opencode/grok-code",
  },
} as const;

export function generateLiteConfig(installConfig: InstallConfig): Record<string, unknown> {
  // Determine base provider
  const baseProvider = installConfig.hasAntigravity
    ? "antigravity"
    : installConfig.hasOpenAI
      ? "openai"
      : "zen-free";

  const config: Record<string, unknown> = {
    preset: baseProvider,
    presets: {},
  };

  // Generate all presets
  for (const [providerName, models] of Object.entries(MODEL_MAPPINGS)) {
    const agents: Record<string, { model: string; skills: string[] }> = Object.fromEntries(
      Object.entries(models).map(([k, v]) => [
        k,
        { model: v, skills: DEFAULT_AGENT_SKILLS[k as keyof typeof DEFAULT_AGENT_SKILLS] ?? [] },
      ])
    );
    (config.presets as Record<string, unknown>)[providerName] = agents;
  }

  // Handle mixed configuration (antigravity + openai)
  if (installConfig.hasAntigravity && installConfig.hasOpenAI) {
    const mixedAgents: Record<string, string> = { ...MODEL_MAPPINGS.antigravity };
    mixedAgents.oracle = "openai/gpt-5.2-codex";
    const agents: Record<string, { model: string; skills: string[] }> = Object.fromEntries(
      Object.entries(mixedAgents).map(([k, v]) => [
        k,
        { model: v, skills: DEFAULT_AGENT_SKILLS[k as keyof typeof DEFAULT_AGENT_SKILLS] ?? [] },
      ])
    );
    (config.presets as Record<string, unknown>)["antigravity-openai"] = agents;
    config.preset = "antigravity-openai";
  }

  if (installConfig.hasTmux) {
    config.tmux = {
      enabled: true,
      layout: "main-vertical",
      main_pane_size: 60,
    };
  }

  return config;
}
