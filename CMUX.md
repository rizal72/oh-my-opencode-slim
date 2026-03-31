# CMUX Integration Plan

## Status: ARCHIVED

**Decision Date:** 2026-03-31  
**Decision:** Project archived due to critical limitations in cmux that make it unsuitable as a tmux replacement for oh-my-opencode-slim.

---

## Overview
Add cmux (macOS terminal multiplexer) as an alternative backend to tmux for oh-my-opencode-slim, making the plugin multiplexer-agnostic.

## Goals
- Maintain full backward compatibility with existing tmux configurations
- Add cmux support via explicit configuration option
- Create clean abstraction layer for future multiplexer backends
- Target: PR to upstream oh-my-opencode-slim repository

## Architecture

### Backend Interface
```typescript
interface MultiplexerBackend {
  readonly type: 'tmux' | 'cmux' | 'none';
  isAvailable(): boolean;
  spawnPane(sessionId, description, config, serverUrl): Promise<SpawnPaneResult>;
  closePane(paneId): Promise<boolean>;
  applyLayout(config): Promise<void>;
  initialize?(): Promise<void>;
}
```

### File Structure
```
src/multiplexer/
├── types.ts                    # Interface definitions
├── tmux-backend.ts             # Extracted from utils/tmux.ts
├── cmux-backend.ts             # New cmux implementation
├── index.ts                    # Factory function + exports
└── __tests__/
    ├── tmux-backend.test.ts
    ├── cmux-backend.test.ts
    └── factory.test.ts

src/background/
├── multiplexer-session-manager.ts   # Refactored from tmux-session-manager.ts
├── background-manager.ts              # Updated to use new config
└── __tests__/

src/config/
└── schema.ts                   # Updated with MultiplexerConfigSchema

src/utils/
└── tmux.ts                     # Deprecated compatibility shim

src/index.ts                  # Updated initialization
```

## Why Archived

After comprehensive research into cmux capabilities (GitHub source, official documentation, and API reference), the following critical blockers were identified that make cmux unsuitable as a production backend:

### 1. No Layout Management (BLOCKER)
cmux **completely lacks** automatic layout management. From the source code analysis, `select-layout` is explicitly a NO-OP:

```swift
case "select-layout", "set-option", "set", "set-window-option", "setw":
    return  // These commands are NO-OPs in tmux compat mode
```

**Impact:** oh-my-opencode-slim's core feature - automatic pane layout with `main-vertical`, `main-horizontal`, `tiled` - would be completely non-functional. Users would have to manually resize panes, defeating the purpose of the plugin.

### 2. Fragile Process Signaling (BLOCKER)
cmux has **no direct signal sending mechanism**:
- No `send-keys C-c` equivalent (only limited `send-key` with specific keys)
- No SIGTERM/SIGINT sending
- Workaround requires sending ASCII 0x03 (Ctrl+C) as text, which is fragile

**Impact:** Risk of orphaned opencode processes when closing subagent panes. Graceful shutdown - a core requirement for clean session management - cannot be reliably implemented.

### 3. Ghost Pane Problem (MAJOR)
cmux architecture: Window → Workspace → Pane → Surface (tab)
- Closing a surface leaves the parent pane open if other surfaces exist
- No automatic pane cleanup

**Impact:** Accumulation of empty panes when subagents complete. Would require complex tracking logic to determine when to close parent panes.

### 4. Two-Step Spawn (MAJOR)
Unlike tmux's atomic `split-window "command"`, cmux requires:
```bash
cmux new-surface  # Step 1
cmux send-surface surface:N "command\n"  # Step 2
```

**Impact:** Race conditions between surface creation and command execution. More complex error handling required.

### 5. Platform Lock-in (MINOR)
cmux is macOS 14.0+ only. While this doesn't affect existing tmux users, it limits the feature to a subset of users.

---

## Conclusion

cmux is a promising multiplexer with excellent browser integration and macOS-native features, but its current CLI limitations make it unsuitable as a drop-in tmux replacement for oh-my-opencode-slim's use case.

**Recommendation:** Re-evaluate if cmux adds:
1. `select-layout` support
2. Full `send-keys` compatibility
3. Automatic pane cleanup on last surface close

**Starting point preserved:** Tag `v0.9.0-cmux-start` remains available if revisiting this project in the future.

### Phase 1: Foundation
1. Create `src/multiplexer/types.ts` with interface definitions
2. Create `src/multiplexer/index.ts` with factory function
3. Keep existing code functional (no breaking changes)

### Phase 2: TmuxBackend Extraction
1. Extract tmux logic from `src/utils/tmux.ts` into `src/multiplexer/tmux-backend.ts`
2. Implement `TmuxBackend` class conforming to `MultiplexerBackend`
3. Update `src/utils/tmux.ts` to delegate to backend (compatibility shim)
4. Add tests for TmuxBackend

### Phase 3: CmuxBackend Implementation
1. Create `src/multiplexer/cmux-backend.ts`
2. Implement cmux detection (`CMUX` env var)
3. Implement spawn/close/layout methods using cmux CLI
4. Add tests for CmuxBackend

### Phase 4: Configuration Update
1. Add `MultiplexerConfigSchema` to `src/config/schema.ts`
2. Add migration logic from old `tmux.enabled` to new `multiplexer.type`
3. Maintain backward compatibility

### Phase 5: Session Manager Refactoring
1. Rename `TmuxSessionManager` to `MultiplexerSessionManager`
2. Update to use `MultiplexerBackend` interface
3. Remove tmux-specific code, use backend abstraction

### Phase 6: Integration
1. Update `src/index.ts` to initialize backend via factory
2. Wire up new configuration
3. Test both tmux and cmux paths

### Phase 7: Testing & Documentation
1. Unit tests for all backends
2. Integration tests with mock backend
3. Update documentation
4. Verify backward compatibility

## Configuration

### New Configuration Schema
```typescript
// ~/.config/opencode/oh-my-opencode-slim.json
{
  "multiplexer": {
    "type": "none",           // "tmux" | "cmux" | "none" (explicit required)
    "layout": "main-vertical", // Same options as before
    "main_pane_size": 60       // Same as before
  }
}
```

**Note:** The `type` field is required and must be explicitly set. No auto-detection.
- `"none"` (default): No multiplexer integration
- `"tmux"`: Use tmux backend (requires running inside tmux)
- `"cmux"`: Use cmux backend (requires running inside cmux)

### Backward Compatibility
Old configuration remains valid:
```typescript
// Legacy format (still supported)
{
  "tmux": {
    "enabled": true,
    "layout": "main-vertical",
    "main_pane_size": 60
  }
}
```

Migration: `tmux.enabled: true` → `multiplexer.type: "tmux"` (explicit, not auto)

## cmux Implementation Details

### Detection
```typescript
isAvailable(): boolean {
  // cmux sets multiple env vars when running inside it
  return !!process.env.CMUX_WORKSPACE_ID && !!process.env.CMUX_SURFACE_ID;
}
```

**Environment variables set by cmux:**
- `CMUX_WORKSPACE_ID` - Current workspace UUID
- `CMUX_SURFACE_ID` - Current surface UUID  
- `CMUX_SOCKET_PATH` - Path to control socket
- `TERM_PROGRAM` - Set to `ghostty` (not sufficient alone, need cmux vars)

### Spawn Flow
cmux requires a **two-step process** (unlike tmux's single command):

```bash
# Step 1: Create terminal surface in current pane
# Returns surface reference (e.g., "surface:7")
cmux new-surface --type terminal

# Step 2: Send the command to the new surface
cmux send-surface --surface surface:7 "opencode attach <serverUrl> --session <sessionId>\n"
```

**Alternative with split:**
```bash
# 1. Get current context
cmux identify --json

# 2. Create split (returns new pane reference)
cmux new-split right --panel pane:N

# 3. Create surface in the new pane
cmux new-surface --pane pane:N

# 4. Send command
cmux send-surface --surface surface:M "opencode attach ...\n"
```

### Close Flow
**CRITICAL:** cmux has limited process signaling. We must manually send Ctrl+C before closing.

```bash
# Step 1: Send Ctrl+C (ASCII 0x03) for graceful shutdown
cmux send-surface --surface surface:7 $'\x03'

# Step 2: Wait for process to terminate
sleep 0.25

# Step 3: Close the surface
cmux close-surface --surface surface:7
```

**Note:** cmux does NOT have direct signal sending like tmux's `send-keys`. The `send` command only supports:
- Text strings (with escape sequences \n, \r, \t)
- Limited keys via `send-key`: enter, tab, escape, backspace, delete, up, down, left, right

### Layout Limitations
**CRITICAL:** cmux does NOT have automatic layout management.

**tmux commands that are NO-OP in cmux:**
- `select-layout` - Not supported (main-horizontal, main-vertical, tiled, etc.)
- `set-window-option main-pane-width/height` - Not supported
- `even-horizontal`, `even-vertical` - Not supported

**What cmux supports:**
- `resize-pane --pane pane:N -L|-R|-U|-D --amount <n>` - Directional resize only
- `new-split left|right|up|down` - Manual split creation

**Implementation approach:**
- `applyLayout()` will log a warning: "cmux does not support automatic layouts"
- Layout configuration will be ignored for cmux backend
- Users must manually arrange panes in cmux
- Future: Implement manual resize logic if needed

## Testing Strategy

### Unit Tests
- Mock environment variables (TMUX, CMUX)
- Mock subprocess spawning
- Test backend factory selection logic
- Test configuration migration

### Integration Tests
- Use MockBackend for session manager testing
- Test event handling (session.created, session.status, session.deleted)
- Test cleanup scenarios

### Manual Testing
- Test tmux path (verify no regression)
- Test cmux path (inside cmux session)
- Test explicit "none" setting (no multiplexer)

## Critical Differences from tmux

### 1. Architecture Model
| tmux | cmux |
|------|------|
| Window → Pane (terminal) | Window → Workspace → Pane → Surface (terminal/browser) |
| Pane = terminal | Pane = split region, Surface = tab within pane |
| Single terminal per pane | Multiple surfaces (tabs) possible per pane |

**Impact:** When closing a surface in cmux, the parent pane may remain open if other surfaces exist.

### 2. Command Execution
| Feature | tmux | cmux |
|---------|------|------|
| Single-command spawn | `split-window "cmd"` | Two-step: `new-surface` + `send` |
| Send keys | Full support (`send-keys C-c Enter`) | Limited (`send`, `send-key` with restricted keys) |
| Signals | `send-keys -s SIGTERM` | **NOT SUPPORTED** |

### 3. Layout Management
| Feature | tmux | cmux |
|---------|------|------|
| Automatic layouts | Yes (`select-layout`) | **NO** |
| Resize | Percentage-based | Directional only (-L, -R, -U, -D) |
| Rebalancing | Automatic | Manual only |

### 4. Platform & Session
| Feature | tmux | cmux |
|---------|------|------|
| Cross-platform | Linux, macOS, Windows (WSL) | **macOS 14.0+ only** |
| Session restore | Full (processes + state) | Layout only (no process restoration) |
| Socket API | No | Yes (JSON RPC) |

### 5. tmux Compatibility Gaps (NOT supported in cmux)
From cmux source code, these tmux commands are NO-OPs:
- `select-layout`, `set-option`, `set-window-option`
- `swap-pane`, `break-pane`, `join-pane`
- `pipe-pane`, `wait-for`, `popup`
- `bind-key`, `unbind-key`, `copy-mode`
- `source-file`, `refresh-client`

## Known Limitations

1. **Layout Management**: cmux completely lacks automatic layout system. Layout config is ignored.
2. **Process Signaling**: No direct SIGTERM/SIGINT. Must use Ctrl+C via `send` with ASCII 0x03.
3. **Platform**: cmux is macOS 14.0+ only. Linux users must use tmux.
4. **Session Restore**: cmux does not restore live process state. Active sessions are not resumed after restart.
5. **Surface Lifecycle**: Closing a surface leaves the parent pane open if other surfaces exist. May create "ghost panes".
6. **Command Execution**: Two-step process (create surface + send command) instead of tmux's atomic spawn.
7. **Surface References**: Short refs (`surface:N`) are session-only, not persistent across restarts.
8. **Socket Access**: Default mode `cmuxOnly` means only cmux-spawned processes can connect. Our plugin may need `allowAll` mode.

## PR Checklist

- [ ] All existing tests pass
- [ ] New tests for backends
- [ ] Backward compatibility verified
- [ ] Documentation updated
- [ ] Code review by @oracle
- [ ] Tested in both tmux and cmux environments

## References

- cmux GitHub: https://github.com/manaflow-ai/cmux
- cmux docs: https://cmux.com/docs/api
- cmux concepts: https://cmux.com/docs/concepts
- cmux oh-my-opencode integration: https://cmux.com/docs/agent-integrations/oh-my-opencode
- cmux skill: https://skills.sh/manaflow-ai/cmux
- Starting tag: v0.9.0-cmux-start
