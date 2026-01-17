// MCP types - McpName is defined in config/schema.ts to avoid duplication

export type RemoteMcpConfig = {
  type: "remote";
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
};
