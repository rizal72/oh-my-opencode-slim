# Quick Wins - Immediate Optimizations

This document lists optimizations that can be implemented quickly (< 30 minutes each) for immediate benefit.

---

## 1. Add Memory Cleanup to BackgroundTaskManager (15 mins) 🔴

**File:** `src/background/background-manager.ts`

**Problem:** Tasks accumulate in memory indefinitely

**Fix:** Add this after line 349 in `completeTask()`:

```typescript
// Auto-cleanup completed tasks after 1 hour
setTimeout(() => {
  this.tasks.delete(task.id);
  log(`[background-manager] cleaned up task: ${task.id}`);
}, 3600000);
```

---

## 2. Cache Agent Prompts (10 mins) 🟡

**File:** `src/config/loader.ts`

**Problem:** Prompt files are re-read on every call

**Fix:** Add at the top of the file (after imports):

```typescript
const promptCache = new Map<string, { prompt?: string; appendPrompt?: string }>();
```

Then wrap the `loadAgentPrompt` function (line 169):

```typescript
export function loadAgentPrompt(agentName: string): {
  prompt?: string;
  appendPrompt?: string;
} {
  // Check cache first
  if (promptCache.has(agentName)) {
    return promptCache.get(agentName)!;
  }

  // ... existing code ...
  
  // Before return, cache the result
  promptCache.set(agentName, { prompt, appendPrompt });
  return { prompt, appendPrompt };
}
```

---

## 3. Add LSP Connection Pool Limit (10 mins) 🔴

**File:** `src/tools/lsp/client.ts`

**Problem:** Unbounded LSP client growth

**Fix:** Add to `LSPServerManager` class (after line 29):

```typescript
private readonly MAX_CLIENTS = 10;

async getClient(root: string, server: ResolvedServer): Promise<LSPClient> {
  const key = this.getKey(root, server.id);
  
  // Check pool size before creating
  if (!this.clients.has(key) && this.clients.size >= this.MAX_CLIENTS) {
    // Evict oldest idle client
    let oldest: [string, ManagedClient] | null = null;
    for (const [k, v] of this.clients) {
      if (v.refCount === 0) {
        if (!oldest || v.lastUsedAt < oldest[1].lastUsedAt) {
          oldest = [k, v];
        }
      }
    }
    if (oldest) {
      oldest[1].client.stop();
      this.clients.delete(oldest[0]);
    }
  }
  
  // ... rest of existing code
}
```

---

## 4. Add Log Level Control (20 mins) 🟡

**File:** `src/utils/logger.ts`

**Problem:** Always-on verbose logging

**Fix:** Replace entire file with:

```typescript
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

let currentLogLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function log(
  message: string,
  data?: Record<string, unknown>,
  level: LogLevel = LogLevel.INFO,
): void {
  if (level > currentLogLevel) return;
  
  if (data && Object.keys(data).length > 0) {
    console.log(`[oh-my-opencode-slim] ${message}`, data);
  } else {
    console.log(`[oh-my-opencode-slim] ${message}`);
  }
}

export function logDebug(message: string, data?: Record<string, unknown>): void {
  log(message, data, LogLevel.DEBUG);
}

export function logError(message: string, data?: Record<string, unknown>): void {
  log(message, data, LogLevel.ERROR);
}
```

Then update `src/config/schema.ts`:

```typescript
export const PluginConfigSchema = z.object({
  // ... existing fields
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});
```

And update `src/index.ts` to set log level from config:

```typescript
import { log, setLogLevel, LogLevel } from './utils/logger';

const OhMyOpenCodeLite: Plugin = async (ctx) => {
  const config = loadPluginConfig(ctx.directory);
  
  // Set log level from config
  const logLevelMap = {
    error: LogLevel.ERROR,
    warn: LogLevel.WARN,
    info: LogLevel.INFO,
    debug: LogLevel.DEBUG,
  };
  setLogLevel(logLevelMap[config.logLevel ?? 'info']);
  
  // ... rest of code
};
```

---

## 5. Optimize Message Extraction (15 mins) 🟡

**File:** `src/background/background-manager.ts`

**Problem:** Multiple array allocations and iterations

**Fix:** Replace lines 276-290 with:

```typescript
let responseText = '';

for (const message of messages) {
  if (message.info?.role !== 'assistant') continue;
  
  for (const part of message.parts ?? []) {
    if ((part.type === 'text' || part.type === 'reasoning') && part.text) {
      if (part.text.length > 0) {
        if (responseText) responseText += '\n\n';
        responseText += part.text;
      }
    }
  }
}

if (!responseText) {
  this.completeTask(task, 'completed', '(No output)');
} else {
  this.completeTask(task, 'completed', responseText);
}
```

---

## 6. Pre-compile RegExp (5 mins) 🔵

**File:** `src/hooks/auto-update-checker/checker.ts`

**Problem:** RegExp compiled on every function call

**Fix:** Add at top of file (after imports):

```typescript
const DIST_TAG_REGEX = /^\d/;
const CHANNEL_REGEX = /^(alpha|beta|rc|canary|next)/;
```

Then update functions:

```typescript
function isDistTag(version: string): boolean {
  return !DIST_TAG_REGEX.test(version);
}

// In extractChannel function (line 48):
const channelMatch = prereleasePart.match(CHANNEL_REGEX);
```

---

## 7. Add Rate Limiting to Auto-Update Checker (10 mins) 🟡

**File:** `src/hooks/auto-update-checker/index.ts`

**Problem:** Checks on every event without throttling

**Fix:** In the checker instance creation:

```typescript
export function createAutoUpdateCheckerHook(
  ctx: PluginInput,
  options: AutoUpdateCheckerOptions,
) {
  let lastCheckTime = 0;
  const MIN_CHECK_INTERVAL = 3600000; // 1 hour

  return {
    async event(input: PluginEventInput): Promise<void> {
      const now = Date.now();
      
      // Rate limit checks to once per hour
      if (now - lastCheckTime < MIN_CHECK_INTERVAL) {
        return;
      }
      
      lastCheckTime = now;
      
      // ... existing check logic
    },
  };
}
```

---

## 8. Enable Build Minification (2 mins) 🔵

**File:** `package.json`

**Problem:** Large bundle size

**Fix:** Update build script:

```json
{
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun --format esm --minify --sourcemap && bun build src/cli/index.ts --outdir dist/cli --target bun --format esm --minify && tsc --emitDeclarationOnly"
  }
}
```

---

## 9. Add .nvmrc / .node-version (2 mins) 🔵

**File:** `.node-version` (create new)

**Problem:** No Node version specification

**Fix:** Create file with:

```
20
```

This ensures consistent runtime across environments.

---

## 10. Add Performance Timing to Critical Operations (15 mins) 🟢

**File:** Multiple files

**Problem:** No visibility into performance bottlenecks

**Fix:** Add timing wrapper function in `src/utils/index.ts`:

```typescript
export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    if (duration > 100) {
      log(`[perf] ${label} took ${duration.toFixed(2)}ms`, undefined, LogLevel.DEBUG);
    }
  }
}
```

Then wrap critical operations:

```typescript
// In src/index.ts
const config = await timed('loadPluginConfig', () => 
  loadPluginConfigAsync(ctx.directory)
);

const agents = await timed('createAgents', () => 
  createAgents(config)
);
```

---

## Implementation Order

1. **Start with P0 items** (Memory leak, LSP pool limit) - 25 mins total
2. **Add logging improvements** (Log levels) - 20 mins
3. **Add caching** (Agent prompts) - 10 mins
4. **Optimize hot paths** (Message extraction) - 15 mins
5. **Polish** (RegExp, rate limiting, minification) - 20 mins

**Total time investment: ~90 minutes for 10 quick wins**

**Expected impact:**
- 🔴 Prevent production issues (memory leaks, resource exhaustion)
- 🟡 20-30% performance improvement
- 🟢 Better developer experience (logging, debugging)
- 🔵 Smaller bundle, cleaner code

---

## Testing After Changes

```bash
# Run tests to ensure no regressions
bun test

# Type check
bun run typecheck

# Format and lint
bun run check

# Build and verify
bun run build
```

---

## Notes

- All changes are backwards compatible
- No breaking API changes
- Can be implemented incrementally
- Each change is independently testable
