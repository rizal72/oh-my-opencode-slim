# Architecture & Design Insights

This document provides architectural observations and recommendations based on the codebase review.

---

## Current Architecture

### Strengths ✅

1. **Clean Module Separation**
   - Well-organized into logical domains: `agents/`, `tools/`, `config/`, `hooks/`, `utils/`
   - Clear separation of concerns
   - Minimal coupling between modules

2. **Strong Type Safety**
   - Comprehensive TypeScript usage with strict mode enabled
   - Zod schemas for runtime validation
   - Good use of discriminated unions and type guards

3. **Excellent Test Coverage**
   - 269 tests across 23 test files
   - Good coverage of critical paths
   - Fast test execution (3.24s)

4. **Plugin Architecture**
   - Clean plugin interface via `@opencode-ai/plugin`
   - Proper event-driven design
   - Good use of hooks for cross-cutting concerns

5. **Configuration System**
   - Flexible config merging (user + project)
   - Support for presets
   - Good defaults with override capability

### Areas for Improvement 🔧

1. **Resource Management**
   - No automatic cleanup of long-lived resources
   - Unbounded growth in several managers (BackgroundTaskManager, LSPServerManager)
   - Missing health checks and monitoring

2. **Initialization Performance**
   - Synchronous file I/O blocks startup
   - No lazy loading of optional features
   - Eager initialization of all subsystems

3. **Error Handling**
   - Inconsistent error handling patterns
   - Missing error boundaries in critical sections
   - Silent failures in some areas

4. **Observability**
   - No structured logging levels
   - Missing performance metrics
   - No telemetry for production debugging

---

## Design Patterns Used

### Factory Pattern
- **Location:** `src/agents/`
- **Usage:** Agent creation with configurable models and prompts
- **Benefits:** Encapsulates creation logic, supports customization
- **Rating:** ⭐⭐⭐⭐⭐ Excellent use

### Singleton Pattern
- **Location:** `src/tools/lsp/client.ts` (LSPServerManager)
- **Usage:** Global LSP client pool
- **Benefits:** Shared resource management
- **Concern:** Could benefit from lifecycle management
- **Rating:** ⭐⭐⭐⭐ Good, needs resource limits

### Observer Pattern
- **Location:** `src/background/` (event handlers)
- **Usage:** Session status monitoring, task completion
- **Benefits:** Decoupled event handling
- **Rating:** ⭐⭐⭐⭐⭐ Excellent use

### Strategy Pattern
- **Location:** `src/agents/` (agent variants)
- **Usage:** Different agent configurations per use case
- **Benefits:** Flexible agent behavior
- **Rating:** ⭐⭐⭐⭐ Good implementation

### Builder Pattern
- **Location:** `src/config/` (config merging)
- **Usage:** Layered configuration building
- **Benefits:** Flexible, composable configs
- **Rating:** ⭐⭐⭐⭐⭐ Excellent use

---

## Architecture Recommendations

### 1. Implement Resource Lifecycle Management

**Problem:** Resources created but never cleaned up

**Solution:** Implement a resource manager

```typescript
// src/utils/resource-manager.ts
export class ResourceManager {
  private resources = new Map<string, Disposable>();
  
  register(id: string, resource: Disposable): void {
    this.resources.set(id, resource);
  }
  
  async dispose(id?: string): Promise<void> {
    if (id) {
      const resource = this.resources.get(id);
      if (resource) {
        await resource.dispose();
        this.resources.delete(id);
      }
    } else {
      // Dispose all
      for (const [id, resource] of this.resources) {
        await resource.dispose();
        this.resources.delete(id);
      }
    }
  }
}

interface Disposable {
  dispose(): Promise<void> | void;
}
```

**Usage:**
```typescript
// In src/index.ts
const resourceManager = new ResourceManager();

resourceManager.register('lsp', lspManager);
resourceManager.register('background', backgroundManager);

// On plugin shutdown
await resourceManager.dispose();
```

---

### 2. Add Circuit Breaker for External Services

**Problem:** No protection against cascading failures (LSP, MCP)

**Solution:** Implement circuit breaker pattern

```typescript
// src/utils/circuit-breaker.ts
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly threshold = 5,
    private readonly timeout = 60000, // 1 minute
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
}
```

**Usage:**
```typescript
// Wrap LSP calls
const lspBreaker = new CircuitBreaker();

async function safeLspCall<T>(fn: () => Promise<T>): Promise<T> {
  return lspBreaker.execute(fn);
}
```

---

### 3. Add Retry Logic with Backoff

**Problem:** No retry logic for transient failures

**Solution:** Exponential backoff utility

```typescript
// src/utils/retry.ts
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
  } = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 100,
    maxDelay = 5000,
    backoffFactor = 2,
  } = options;
  
  let lastError: Error | undefined;
  let delay = initialDelay;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffFactor, maxDelay);
      }
    }
  }
  
  throw lastError;
}
```

---

### 4. Implement Event Bus for Cross-Module Communication

**Problem:** Tight coupling through direct imports

**Solution:** Event bus for decoupled communication

```typescript
// src/utils/event-bus.ts
type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  
  on<T>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    
    this.handlers.get(event)!.push(handler as EventHandler);
    
    // Return unsubscribe function
    return () => this.off(event, handler);
  }
  
  off<T>(event: string, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler as EventHandler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }
  
  async emit<T>(event: string, data: T): Promise<void> {
    const handlers = this.handlers.get(event);
    if (handlers) {
      await Promise.all(handlers.map(h => h(data)));
    }
  }
}
```

**Usage:**
```typescript
// Global event bus
const eventBus = new EventBus();

// In background manager
eventBus.emit('task:completed', { taskId: task.id, result });

// In hooks
eventBus.on('task:completed', async ({ taskId, result }) => {
  // React to task completion
});
```

---

### 5. Add Health Check System

**Problem:** No way to monitor plugin health

**Solution:** Health check aggregator

```typescript
// src/utils/health.ts
export interface HealthCheck {
  name: string;
  check(): Promise<HealthStatus>;
}

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

export class HealthMonitor {
  private checks = new Map<string, HealthCheck>();
  
  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }
  
  async checkAll(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {};
    
    for (const [name, check] of this.checks) {
      try {
        results[name] = await check.check();
      } catch (error) {
        results[name] = {
          healthy: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    
    return results;
  }
  
  async isHealthy(): Promise<boolean> {
    const results = await this.checkAll();
    return Object.values(results).every(r => r.healthy);
  }
}
```

**Usage:**
```typescript
// Register health checks
healthMonitor.register({
  name: 'lsp',
  async check() {
    const clientCount = lspManager.getClientCount();
    return {
      healthy: clientCount < 10,
      details: { clientCount },
    };
  },
});

healthMonitor.register({
  name: 'background-tasks',
  async check() {
    const activeCount = backgroundManager.getActiveCount();
    return {
      healthy: activeCount < 50,
      details: { activeCount },
    };
  },
});
```

---

## Performance Architecture Patterns

### 1. Lazy Initialization

**Current:** Eager initialization of all subsystems
**Recommended:** Lazy initialization for optional features

```typescript
class LazyService<T> {
  private instance?: T;
  
  constructor(private factory: () => T) {}
  
  get(): T {
    if (!this.instance) {
      this.instance = this.factory();
    }
    return this.instance;
  }
}

// Usage
const lspTools = new LazyService(() => import('./tools/lsp'));
```

### 2. Object Pool Pattern

**Use Case:** Reusable objects (LSP clients, background tasks)

```typescript
class ObjectPool<T> {
  private available: T[] = [];
  private inUse = new Set<T>();
  
  constructor(
    private factory: () => T,
    private maxSize: number,
  ) {}
  
  acquire(): T {
    let obj = this.available.pop();
    
    if (!obj && this.inUse.size < this.maxSize) {
      obj = this.factory();
    }
    
    if (obj) {
      this.inUse.add(obj);
    }
    
    return obj!;
  }
  
  release(obj: T): void {
    this.inUse.delete(obj);
    this.available.push(obj);
  }
}
```

### 3. Cache with TTL

**Use Case:** Config files, agent prompts

```typescript
class TTLCache<K, V> {
  private cache = new Map<K, { value: V; expiry: number }>();
  
  constructor(private ttl: number) {}
  
  set(key: K, value: V): void {
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttl,
    });
  }
  
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) return undefined;
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  }
  
  clear(): void {
    this.cache.clear();
  }
}
```

---

## Monitoring & Observability

### Recommended Metrics

1. **Plugin Metrics**
   - Initialization time
   - Memory usage
   - Active sessions count

2. **Agent Metrics**
   - Delegations per agent
   - Response times
   - Error rates

3. **Tool Metrics**
   - Tool execution times
   - Tool usage frequency
   - Tool error rates

4. **Background Task Metrics**
   - Queue depth
   - Task completion times
   - Task success/failure rates

5. **LSP Metrics**
   - Active client count
   - Request latencies
   - Cache hit rates

### Implementation

```typescript
// src/utils/metrics.ts
export class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  
  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }
  
  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }
  
  histogram(name: string, value: number): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, []);
    }
    this.histograms.get(name)!.push(value);
  }
  
  getStats(): Record<string, unknown> {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([name, values]) => [
          name,
          {
            count: values.length,
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            min: Math.min(...values),
            max: Math.max(...values),
          },
        ]),
      ),
    };
  }
}

// Global metrics instance
export const metrics = new MetricsCollector();
```

---

## Testing Recommendations

### 1. Add Performance Tests

```typescript
// src/__tests__/performance.test.ts
import { describe, expect, test } from 'bun:test';

describe('Performance', () => {
  test('plugin initialization should complete within 100ms', async () => {
    const start = performance.now();
    await initPlugin();
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(100);
  });
  
  test('background task launch should complete within 50ms', async () => {
    const start = performance.now();
    backgroundManager.launch({ /* ... */ });
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(50);
  });
});
```

### 2. Add Integration Tests

```typescript
// src/__tests__/integration.test.ts
test('end-to-end task flow', async () => {
  const task = backgroundManager.launch({
    agent: 'explorer',
    prompt: 'test',
    description: 'test task',
    parentSessionId: 'test',
  });
  
  expect(task.status).toBe('pending');
  
  const completed = await backgroundManager.waitForCompletion(task.id, 30000);
  
  expect(completed?.status).toBeOneOf(['completed', 'failed']);
});
```

### 3. Add Load Tests

```typescript
test('handle 100 concurrent background tasks', async () => {
  const tasks = Array.from({ length: 100 }, (_, i) =>
    backgroundManager.launch({
      agent: 'explorer',
      prompt: `task ${i}`,
      description: `test task ${i}`,
      parentSessionId: 'test',
    })
  );
  
  expect(tasks).toHaveLength(100);
  expect(backgroundManager.getActiveCount()).toBeLessThanOrEqual(10);
});
```

---

## Security Considerations

### 1. Input Validation
- ✅ Using Zod for runtime validation
- ⚠️ Should validate file paths to prevent directory traversal
- ⚠️ Should sanitize MCP names more thoroughly

### 2. Resource Limits
- ⚠️ No memory limits enforced
- ⚠️ No CPU limits
- ⚠️ No rate limiting on tool calls

### 3. Privilege Separation
- ✅ Good use of permission system
- ✅ Agent-specific tool access control
- ✅ MCP access control per agent

---

## Scalability Considerations

### Current Limits
- No limit on concurrent background tasks (only start queue)
- No limit on LSP clients (5-minute idle timeout only)
- No limit on task history

### Recommended Limits
```typescript
const LIMITS = {
  MAX_BACKGROUND_TASKS: 100,
  MAX_LSP_CLIENTS: 10,
  MAX_TASK_HISTORY: 100,
  MAX_SESSION_MEMORY: 1000, // messages
  MAX_LOG_SIZE: 10_000_000, // 10MB
};
```

---

## Summary

The codebase has a solid architectural foundation with good separation of concerns and strong type safety. The main areas for improvement are:

1. **Resource Management:** Add lifecycle management and cleanup
2. **Performance:** Lazy loading, caching, and async I/O
3. **Observability:** Structured logging, metrics, and health checks
4. **Resilience:** Circuit breakers, retries, and error boundaries
5. **Scalability:** Resource limits and pool management

Implementing these patterns will make the plugin more robust, performant, and production-ready.
