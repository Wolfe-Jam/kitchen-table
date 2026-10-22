import { CARD_HTML } from "./card";
import { HOUSEHOLD_ID, type ToolOutput } from "./domain";
import { Household, type Env, type LogEntry } from "./household";
import { RESOURCES, SERVER_INFO, TOOLS, argsHash, negotiate, readResource, validate } from "./mcp";

export { Household };

const JSON_HEADERS = { "content-type": "application/json" };

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Simple mode: one static bearer token from a Worker secret maps to the one demo household. */
function authorized(req: Request, env: Env): boolean {
  const t = bearer(req);
  return !!t && !!env.MCP_TOKEN && timingSafeEqual(t, env.MCP_TOKEN);
}

// Alexa+ requires 401 with NO WWW-Authenticate header (quickstart, "Discovery").
const unauthorized = () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: JSON_HEADERS });

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, any> };

function rpcResult(id: Rpc["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: Rpc["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleRpc(msg: Rpc, env: Env, ctx: ExecutionContext): Promise<unknown | null> {
  const isNotification = msg.id === undefined;
  if (typeof msg.method !== "string") return isNotification ? null : rpcError(msg.id, -32600, "Invalid request");
  const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(HOUSEHOLD_ID));

  switch (msg.method) {
    case "initialize":
      return rpcResult(msg.id, {
        protocolVersion: negotiate(msg.params?.protocolVersion),
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Kitchen Table remembers what each household member needs. Call whats_new_for_me to brief someone, propose_add_to_errand to preview a change, and confirm_proposal only after the speaker says yes in a separate turn.",
      });
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: TOOLS });
    case "resources/list":
      return rpcResult(msg.id, { resources: RESOURCES });
    case "resources/read": {
      const r = readResource(String(msg.params?.uri ?? ""));
      return r ? rpcResult(msg.id, r) : rpcError(msg.id, -32002, "Resource not found");
    }
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const started = Date.now();
      let result: any;
      let notify: { to_id: string; to_name: string; text: string }[] = [];
      const problem = validate(tool.inputSchema, args);
      if (problem) {
        result = { content: [{ type: "text", text: problem }], isError: true };
      } else {
        const out = (await stub.callTool(name, args)) as unknown as ToolOutput;
        result = out.result;
        notify = out.notify;
      }
      const duration_ms = Date.now() - started;
      result._meta = { ...(result._meta ?? {}), duration_ms };
      const entry: LogEntry = {
        at: new Date().toISOString(),
        tool: name,
        args_hash: await argsHash(args),
        duration_ms,
        is_error: result.isError === true,
        turn_gap_ms: (result.structuredContent as any)?.turn_gap_ms,
      };
      console.log(JSON.stringify({ evt: "tool_call", ...entry }));
      ctx.waitUntil(stub.recordLog(entry));
      if (env.NOTIFY_WEBHOOK_URL) {
        for (const n of notify) {
          ctx.waitUntil(
            fetch(env.NOTIFY_WEBHOOK_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(n) }).catch(() => undefined),
          );
        }
      }
      return rpcResult(msg.id, result);
    }
    default:
      if (isNotification) return null; // notifications/initialized etc.
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

async function handleMcp(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (req.method === "GET" || req.method === "DELETE") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  if (!authorized(req, env)) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), { status: 400, headers: JSON_HEADERS });
  }
  const batch = Array.isArray(body);
  const replies: unknown[] = [];
  for (const m of batch ? (body as Rpc[]) : [body as Rpc]) {
    const r = await handleRpc(m ?? {}, env, ctx);
    if (r !== null) replies.push(r);
  }
  if (!replies.length) return new Response(null, { status: 202 });
  const payload = JSON.stringify(batch ? replies : replies[0]);
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
    return new Response(`event: message\ndata: ${payload}\n\n`, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }
  return new Response(payload, { headers: JSON_HEADERS });
}

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const page = (title: string, text: string) =>
  html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;max-width:640px;margin:2rem auto;padding:0 16px"><h1>${title}</h1><p>${text}</p>`);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const stub = () => env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(HOUSEHOLD_ID));

    switch (url.pathname) {
      case "/mcp":
        return handleMcp(req, env, ctx);
      case "/demo":
      case "/demo/":
        // The relative fetch('state') in the card resolves to /demo/state or /state; serve both.
        return html(CARD_HTML);
      case "/demo/state":
      case "/state":
        return new Response(JSON.stringify(await stub().snapshot()), { headers: { ...JSON_HEADERS, "cache-control": "no-store" } });
      case "/demo/log":
        return new Response(JSON.stringify({ log: await stub().readLog() }), { headers: { ...JSON_HEADERS, "cache-control": "no-store" } });
      case "/admin/reset": {
        if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
        const given = req.headers.get("x-admin-secret") ?? "";
        if (!env.ADMIN_SECRET || !timingSafeEqual(given, env.ADMIN_SECRET)) return unauthorized();
        let now: string | null | undefined;
        try {
          const b = (await req.json()) as { now?: string | null };
          if (b && "now" in b) now = b.now;
        } catch {
          /* empty body: default demo clock */
        }
        try {
          return new Response(JSON.stringify(await stub().reset(now)), { headers: JSON_HEADERS });
        } catch {
          return new Response(JSON.stringify({ error: "now must be an ISO timestamp or null" }), { status: 400, headers: JSON_HEADERS });
        }
      }
      case "/privacy":
        return page("Kitchen Table privacy", "Kitchen Table is a hackathon demo. It stores only fictional household data supplied by the demo. It collects no personal data and shares nothing with third parties.");
      case "/terms":
        return page("Kitchen Table terms", "Kitchen Table is a free hackathon demo, provided as is. It makes no purchases and takes no real-world actions.");
      case "/":
        return page("Kitchen Table", "MCP server for an Alexa+ household helper. POST /mcp (bearer token). Live board at <a href=\"/demo\">/demo</a>.");
      default:
        return new Response("Not found", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;
