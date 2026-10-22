import { DurableObject } from "cloudflare:workers";
import { DEFAULT_DEMO_NOW, HOUSEHOLD_ID, board, runTool, seed, type State, type ToolOutput } from "./domain";
import { isoNY } from "./time";

export interface Env {
  HOUSEHOLD: DurableObjectNamespace<Household>;
  MCP_TOKEN: string;
  ADMIN_SECRET: string;
  NOTIFY_WEBHOOK_URL?: string;
}

export interface LogEntry {
  at: string;
  tool: string;
  args_hash: string;
  duration_ms: number;
  is_error: boolean;
  turn_gap_ms?: number;
}

/** One Durable Object per household. Strongly consistent, so a confirm can never double-apply. */
export class Household extends DurableObject<Env> {
  private async load(): Promise<State> {
    let s = await this.ctx.storage.get<State>("state");
    if (!s) {
      s = seed(Date.now(), DEFAULT_DEMO_NOW);
      await this.ctx.storage.put("state", s);
    }
    return s;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolOutput> {
    const s = await this.load();
    const out = runTool(s, name, args, Date.now());
    await this.ctx.storage.put("state", s);
    return out;
  }

  /** `now`: undefined = demo clock (Fri Oct 23 2026 6:30 PM ET); null = real clock; string = pinned ISO. */
  async reset(now?: string | null): Promise<{ ok: true; now: string | null }> {
    const pinned = now === undefined ? DEFAULT_DEMO_NOW : now;
    if (pinned !== null && Number.isNaN(Date.parse(pinned))) throw new Error("bad now");
    await this.ctx.storage.put("state", seed(Date.now(), pinned));
    await this.ctx.storage.delete("log");
    return { ok: true, now: pinned };
  }

  async snapshot() {
    const s = await this.load();
    return {
      household: HOUSEHOLD_ID,
      board: board(s, Date.now()),
      inbox: s.inbox.map((m) => ({
        id: m.id,
        to_name: s.members.find((x) => x.id === m.to)?.name ?? m.to,
        text: m.text,
        at_iso: isoNY(m.at_ms),
      })),
    };
  }

  async recordLog(entry: LogEntry): Promise<void> {
    const log = (await this.ctx.storage.get<LogEntry[]>("log")) ?? [];
    log.push(entry);
    await this.ctx.storage.put("log", log.slice(-50));
  }

  async readLog(): Promise<LogEntry[]> {
    return (await this.ctx.storage.get<LogEntry[]>("log")) ?? [];
  }
}
