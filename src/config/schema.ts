import { z } from "zod";

// Agent override configuration (distinct from SDK's AgentConfig)
export const AgentOverrideConfigSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  prompt: z.string().optional(),
  prompt_append: z.string().optional(),
  disable: z.boolean().optional(),
});

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;

// MCP names
export const McpNameSchema = z.enum(["websearch", "context7", "grep_app"]);
export type McpName = z.infer<typeof McpNameSchema>;

// Main plugin config
export const PluginConfigSchema = z.object({
  agents: z.record(z.string(), AgentOverrideConfigSchema).optional(),
  disabled_agents: z.array(z.string()).optional(),
  disabled_mcps: z.array(z.string()).optional(),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// Agent names
export type AgentName =
  | "orchestrator"
  | "oracle"
  | "librarian"
  | "explore"
  | "frontend-ui-ux-engineer"
  | "document-writer"
  | "multimodal-looker"
  | "code-simplicity-reviewer";

export const DEFAULT_MODELS: Record<AgentName, string> = {
  orchestrator: "google/claude-opus-4-5-thinking",
  oracle: "openai/gpt-5.2-codex",
  librarian: "google/gemini-3-flash",
  explore: "cerebras/zai-glm-4.6",
  "frontend-ui-ux-engineer": "google/gemini-3-flash",
  "document-writer": "google/gemini-3-flash",
  "multimodal-looker": "google/gemini-3-flash",
  "code-simplicity-reviewer": "google/claude-opus-4-5-thinking",
};
