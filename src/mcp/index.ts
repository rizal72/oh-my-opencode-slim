import { websearch } from "./websearch";
import { context7 } from "./context7";
import { grep_app } from "./grep-app";
import type { RemoteMcpConfig } from "./types";
import type { McpName } from "../config";

export type { RemoteMcpConfig } from "./types";

const allBuiltinMcps: Record<McpName, RemoteMcpConfig> = {
  websearch,
  context7,
  grep_app,
};

/**
 * Creates MCP configurations, excluding disabled ones
 */
export function createBuiltinMcps(
  disabledMcps: readonly string[] = []
): Record<string, RemoteMcpConfig> {
  return Object.fromEntries(
    Object.entries(allBuiltinMcps).filter(([name]) => !disabledMcps.includes(name))
  );
}
