import type { PluginInput } from "@opencode-ai/plugin";
import { spawnTmuxPane, closeTmuxPane, isInsideTmux } from "../utils/tmux";
import type { TmuxConfig } from "../config/schema";
import { log } from "../shared/logger";
import { POLL_INTERVAL_BACKGROUND_MS } from "../config";

type OpencodeClient = PluginInput["client"];

interface TrackedSession {
  sessionId: string;
  paneId: string;
  parentId: string;
  title: string;
  createdAt: number;
}

/**
 * Event shape for session creation hooks
 */
interface SessionCreatedEvent {
  type: string;
  properties?: { info?: { id?: string; parentID?: string; title?: string } };
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * TmuxSessionManager tracks child sessions (created by OpenCode's Task tool)
 * and spawns/closes tmux panes for them.
 */
export class TmuxSessionManager {
  private client: OpencodeClient;
  private tmuxConfig: TmuxConfig;
  private serverUrl: string;
  private sessions = new Map<string, TrackedSession>();
  private pollInterval?: ReturnType<typeof setInterval>;
  private enabled = false;

  constructor(ctx: PluginInput, tmuxConfig: TmuxConfig) {
    this.client = ctx.client;
    this.tmuxConfig = tmuxConfig;
    this.serverUrl = ctx.serverUrl?.toString() ?? "http://localhost:4096";
    this.enabled = tmuxConfig.enabled && isInsideTmux();

    log("[tmux-session-manager] initialized", {
      enabled: this.enabled,
      tmuxConfig: this.tmuxConfig,
      serverUrl: this.serverUrl,
    });
  }

  /**
   * Handle session.created events.
   * Spawns a tmux pane for child sessions (those with parentID).
   */
  async onSessionCreated(event: {
    type: string;
    properties?: { info?: { id?: string; parentID?: string; title?: string } };
  }): Promise<void> {
    if (!this.enabled) return;
    if (event.type !== "session.created") return;

    const info = event.properties?.info;
    if (!info?.id || !info?.parentID) {
      // Not a child session, skip
      return;
    }

    const sessionId = info.id;
    const parentId = info.parentID;
    const title = info.title ?? "Subagent";

    // Skip if we're already tracking this session
    if (this.sessions.has(sessionId)) {
      log("[tmux-session-manager] session already tracked", { sessionId });
      return;
    }

    log("[tmux-session-manager] child session created, spawning pane", {
      sessionId,
      parentId,
      title,
    });

    const paneResult = await spawnTmuxPane(
      sessionId,
      title,
      this.tmuxConfig,
      this.serverUrl
    ).catch((err) => {
      log("[tmux-session-manager] failed to spawn pane", { error: String(err) });
      return { success: false, paneId: undefined };
    });

    if (paneResult.success && paneResult.paneId) {
      this.sessions.set(sessionId, {
        sessionId,
        paneId: paneResult.paneId,
        parentId,
        title,
        createdAt: Date.now(),
      });

      log("[tmux-session-manager] pane spawned", {
        sessionId,
        paneId: paneResult.paneId,
      });

      this.startPolling();
    }
  }

  private startPolling(): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(() => this.pollSessions(), POLL_INTERVAL_BACKGROUND_MS);
    log("[tmux-session-manager] polling started");
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
      log("[tmux-session-manager] polling stopped");
    }
  }

  private async pollSessions(): Promise<void> {
    if (this.sessions.size === 0) {
      this.stopPolling();
      return;
    }

    try {
      const statusResult = await this.client.session.status();
      const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>;

      const now = Date.now();
      const sessionsToClose: string[] = [];

      for (const [sessionId, tracked] of this.sessions.entries()) {
        const status = allStatuses[sessionId];

        // Session is idle (completed). We don't close on !status here to prevent 
        // aggressive closure during transient API blips.
        const isIdle = status?.type === "idle";

        // Check for timeout as a safety fallback
        const isTimedOut = now - tracked.createdAt > SESSION_TIMEOUT_MS;

        if (isIdle || isTimedOut) {
          sessionsToClose.push(sessionId);
        }
      }

      for (const sessionId of sessionsToClose) {
        await this.closeSession(sessionId);
      }
    } catch (err) {
      log("[tmux-session-manager] poll error", { error: String(err) });
    }
  }

  private async closeSession(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;

    log("[tmux-session-manager] closing session pane", {
      sessionId,
      paneId: tracked.paneId,
    });

    await closeTmuxPane(tracked.paneId);
    this.sessions.delete(sessionId);

    if (this.sessions.size === 0) {
      this.stopPolling();
    }
  }

  /**
   * Create the event handler for the plugin's event hook.
   */
  createEventHandler(): (input: { event: { type: string; properties?: unknown } }) => Promise<void> {
    return async (input) => {
      await this.onSessionCreated(input.event as SessionCreatedEvent);
    };
  }

  /**
   * Clean up all tracked sessions.
   */
  async cleanup(): Promise<void> {
    this.stopPolling();

    if (this.sessions.size > 0) {
      log("[tmux-session-manager] closing all panes", { count: this.sessions.size });
      const closePromises = Array.from(this.sessions.values()).map(s =>
        closeTmuxPane(s.paneId).catch(err =>
          log("[tmux-session-manager] cleanup error for pane", { paneId: s.paneId, error: String(err) })
        )
      );
      await Promise.all(closePromises);
      this.sessions.clear();
    }

    log("[tmux-session-manager] cleanup complete");
  }
}
