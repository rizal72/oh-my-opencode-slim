import type { Plugin } from "@opencode-ai/plugin";
import { getAgentConfigs } from "./agents";
import { BackgroundTaskManager } from "./features";
import { createBackgroundTools } from "./tools";
import { loadPluginConfig } from "./config";
import { createBuiltinMcps } from "./mcp";

const OhMyOpenCodeLite: Plugin = async (ctx) => {
  const config = loadPluginConfig(ctx.directory);
  const agents = getAgentConfigs(config);
  const backgroundManager = new BackgroundTaskManager(ctx);
  const backgroundTools = createBackgroundTools(ctx, backgroundManager);
  const mcps = createBuiltinMcps(config.disabled_mcps);

  return {
    name: "oh-my-opencode-lite",

    agent: agents,

    tool: backgroundTools,

    mcp: mcps,

    config: async (opencodeConfig: Record<string, unknown>) => {
      (opencodeConfig as { default_agent?: string }).default_agent = "orchestrator";

      const configAgent = opencodeConfig.agent as Record<string, unknown> | undefined;
      if (!configAgent) {
        opencodeConfig.agent = { ...agents };
      } else {
        Object.assign(configAgent, agents);
      }

      // Merge MCP configs
      const configMcp = opencodeConfig.mcp as Record<string, unknown> | undefined;
      if (!configMcp) {
        opencodeConfig.mcp = { ...mcps };
      } else {
        Object.assign(configMcp, mcps);
      }
    },
  };
};

export default OhMyOpenCodeLite;

export type { PluginConfig, AgentOverrideConfig, AgentName, McpName } from "./config";
export type { RemoteMcpConfig } from "./mcp";
