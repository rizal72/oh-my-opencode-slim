import { join } from 'node:path';
import {
  type PluginInput,
  type ToolDefinition,
  tool,
} from '@opencode-ai/plugin';

export function createCartographyTool(ctx: PluginInput): ToolDefinition {
  return tool({
    description:
      'Cartography helper script for codebase mapping. Use for directory scanning, hash calculation, and .codemap.json updates.',
    args: {
      command: tool.schema
        .enum(['scan', 'hash', 'update', 'changes'])
        .describe(
          'Command to run: scan (list files), hash (calculate hashes), update (update .codemap.json), changes (report changes without writing)',
        ),
      folder: tool.schema
        .string()
        .optional()
        .describe('Target folder path (relative to session directory)'),
      extensions: tool.schema
        .string()
        .optional()
        .describe(
          'File extensions to map, comma-separated without dots (e.g., "ts,tsx,js")',
        ),
      exclude: tool.schema
        .string()
        .optional()
        .describe(
          'Additional ignore patterns, comma-separated (e.g., "tests,**/*.spec.ts")',
        ),
    },
    execute: async (args, toolContext) => {
      const sessionDir = await getSessionDirectory(ctx, toolContext);

      // Use ctx.directory (plugin project dir) to find the script
      const scriptPath = join(ctx.directory, 'scripts/cartography.ts');

      const extensions = (args.extensions as string) || 'ts,tsx,js,jsx';
      const exclude = (args.exclude as string) || '';
      const commandArgs = [
        'run',
        scriptPath,
        args.command as string,
        (args.folder as string) || '.',
        `--extensions=${extensions}`,
      ];

      if (exclude) {
        commandArgs.push(`--exclude=${exclude}`);
      }

      const result = await Bun.$`bun ${commandArgs}`.cwd(sessionDir);

      try {
        const json = JSON.parse(result.stdout.toString());
        return JSON.stringify(json);
      } catch {
        return JSON.stringify({
          output: result.stdout.toString(),
          stderr: result.stderr.toString(),
        });
      }
    },
  });
}

async function getSessionDirectory(
  ctx: PluginInput,
  toolContext: Record<string, unknown>,
): Promise<string> {
  try {
    const sessionID = toolContext.sessionID as string;
    const session = await ctx.client.session.get({
      path: { id: sessionID },
    });

    if (session?.data?.directory) {
      return session.data.directory;
    }
  } catch (error) {
    console.error('Failed to get session directory:', error);
  }

  return ctx.directory;
}
