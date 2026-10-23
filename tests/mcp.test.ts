// These tests call the live /mcp endpoint of a running Worker (wrangler dev, or BASE_URL).
import { beforeEach, describe, expect, it } from "vitest";

const BASE = process.env.KT_BASE_URL || "http://127.0.0.1:8799";
const TOKEN = process.env.TEST_TOKEN || "test-token";
const ADMIN = process.env.TEST_ADMIN || "test-admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let nextId = 1;
async function rpc(method: string, params?: unknown, opts: { token?: string | null; version?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  return { res, body: res.status === 200 ? ((await res.json()) as any) : null };
}

async function call(name: string, args: Record<string, unknown>) {
  const { body } = await rpc("tools/call", { name, arguments: args });
  return body.result as { content: { text: string }[]; structuredContent: any; isError?: boolean; _meta?: any };
}

async function reset(now?: string | null) {
  const res = await fetch(`${BASE}/admin/reset`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN, "content-type": "application/json" },
    body: now === undefined ? "{}" : JSON.stringify({ now }),
  });
  expect(res.status).toBe(200);
}

const before0Deed = (state: any) => state.board.deed;

beforeEach(async () => {
  await reset();
});

describe("protocol", () => {
  for (const version of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
    it(`initialize echoes ${version}`, async () => {
      const { body } = await rpc("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "1" } });
      expect(body.result.protocolVersion).toBe(version);
      expect(body.result.serverInfo.name).toBe("kitchen-table");
      expect(body.result.serverInfo.version).toBe("1.0.0");
    });
  }

  it("falls back to 2025-11-25 for an unknown version", async () => {
    const { body } = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect(body.result.protocolVersion).toBe("2025-11-25");
  });

  it("tools/list returns exactly the six tools", async () => {
    const { body } = await rpc("tools/list");
    expect(body.result.tools.map((t: any) => t.name).sort()).toEqual(
      ["add_need", "confirm_proposal", "list_errands", "mark_done", "propose_add_to_errand", "whats_new_for_me"],
    );
  });

  it("resources/list and resources/read serve the card", async () => {
    const list = await rpc("resources/list");
    expect(list.body.result.resources[0].uri).toBe("ui://kitchen-table/board");
    const read = await rpc("resources/read", { uri: "ui://kitchen-table/board" });
    expect(read.body.result.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect(read.body.result.contents[0].text).toContain("Kitchen Table");
    expect(read.body.result.contents[0].text).toContain("visibilitychange"); // the board polls gently: visible tab only
  });

  it("notifications get 202 and no body", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
  });

  it("Accept negotiation: prefers application/json when client accepts both, streams when only SSE accepted", async () => {
    // Both accepted → server should reply application/json
    const jsonRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "text/event-stream, application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/list" }),
    });
    expect(jsonRes.headers.get("content-type")).toContain("application/json");

    // Only SSE accepted → server should stream text/event-stream with an event line
    const sseRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/list" }),
    });
    expect(sseRes.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const text = await sseRes.text();
    expect(text).toContain("event: message");
  });

  it("notification with no id gets 202 and an empty body", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("GET /mcp is 405", async () => {
    expect((await fetch(`${BASE}/mcp`)).status).toBe(405);
  });
});

describe("auth", () => {
  it("unauthenticated /mcp is 401 with NO WWW-Authenticate header", async () => {
    const { res } = await rpc("tools/list", undefined, { token: null });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("wrong token is 401 with NO WWW-Authenticate header", async () => {
    const { res } = await rpc("tools/list", undefined, { token: "nope" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("/admin/reset rejects a bad secret", async () => {
    const res = await fetch(`${BASE}/admin/reset`, { method: "POST", headers: { "x-admin-secret": "wrong" } });
    expect(res.status).toBe(401);
  });
});

describe("tools", () => {
  it("every result has structuredContent and speakable text; tool-side latency is under 500 ms", async () => {
    const r = await call("whats_new_for_me", { speaker: "Sam" });
    expect(r.structuredContent).toBeTruthy();
    expect(r.content[0].text.split(/\s+/).length).toBeLessThanOrEqual(75);
    expect(r._meta.duration_ms).toBeLessThan(500);
    expect(r._meta.ui.resourceUri).toBe("ui://kitchen-table/board");
  });

  it("validation errors are speakable isError results", async () => {
    const r = await call("add_need", { speaker: "Maya" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/item/);
    const bad = await call("whats_new_for_me", { speaker: "Sam", limit: 9 });
    expect(bad.isError).toBe(true);
  });

  it("add_need captures owner, item, due and note (Day 1)", async () => {
    const r = await call("add_need", { speaker: "Maya", item: "glue sticks", due: "Sunday", note: "science fair" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.need_id).toMatch(/^need_/);
    expect(r.structuredContent.owner).toBe("member_maya");
    expect(r.structuredContent.due_iso).toMatch(/^2026-10-25T/);
    expect(r.content[0].text).toBe("Got it, Maya. Glue sticks for Sunday's science fair. I'll make sure someone knows.");
  });

  it("whats_new_for_me: ranking puts the poster board first, one calendar line, one yes/no question", async () => {
    const r = await call("whats_new_for_me", { speaker: "dad" });
    const sc = r.structuredContent;
    expect(sc.items.map((i: any) => i.need_id)).toEqual(["need_posterboard", "need_dishsoap"]);
    expect(sc.items[0].suggested_errand_id).toBe("errand_sat_after_soccer");
    expect(sc.next_event.event_id).toBe("event_soccer_am");
    expect(r.content[0].text).toBe(
      "Soccer AM is at 9 AM tomorrow. One more thing: Maya needs poster board for Sunday's science fair. Want me to add it to the 11:30 errand run after soccer?",
    );
    // heard flags: second briefing has nothing new
    const again = await call("whats_new_for_me", { speaker: "Sam" });
    expect(again.structuredContent.items).toEqual([]);
  });

  it("list_errands filters and returns at most 5", async () => {
    const all = await call("list_errands", {});
    expect(all.structuredContent.errands.length).toBeLessThanOrEqual(5);
    const soccer = await call("list_errands", { day: "after soccer" });
    expect(soccer.structuredContent.errands.map((e: any) => e.errand_id)).toEqual(["errand_sat_after_soccer"]);
    const none = await call("list_errands", { day: "Wednesday" });
    expect(none.structuredContent.errands).toEqual([]);
  });

  it("full flow: propose does not write; confirm needs a separate turn; then it commits and nudges Priya", async () => {
    await call("whats_new_for_me", { speaker: "Sam" });
    const p = await call("propose_add_to_errand", { need_id: "need_posterboard", errand_id: "errand_sat_after_soccer" });
    expect(p.structuredContent.requires_confirmation).toBe(true);
    expect(p.content[0].text).toBe("Add poster board for Maya to Saturday's 11:30 errand run after soccer, and let Priya know?");

    expect(before0Deed(await (await fetch(`${BASE}/demo/state`)).json())).toBeNull();
    // nothing written yet
    const before = await (await fetch(`${BASE}/demo/state`)).json() as any;
    expect(before.board.needs.find((n: any) => n.need_id === "need_posterboard").status).toBe("open");
    expect(before.inbox).toEqual([]);

    await sleep(1100);
    const c = await call("confirm_proposal", { proposal_id: p.structuredContent.proposal_id, confirmed: true });
    expect(c.isError).toBeFalsy();
    expect(c.structuredContent).toMatchObject({ need_id: "need_posterboard", errand_id: "errand_sat_after_soccer", status: "scheduled", notified: ["member_priya"] });
    expect(c.structuredContent.turn_gap_ms).toBeGreaterThanOrEqual(1000);
    const sat = c.structuredContent.board.errands.find((e: any) => e.errand_id === "errand_sat_after_soccer");
    expect(sat.items).toContainEqual({ label: "poster board", need_id: "need_posterboard", from: "Maya" });

    expect(c.structuredContent.board.deed).toEqual({ member_id: "member_sam", name: "Sam", count: 1, text: "got Maya's poster board on the run" });

    // Priya's inbox
    const after = await (await fetch(`${BASE}/demo/state`)).json() as any;
    expect(after.inbox[0].to_name).toBe("Priya");
    expect(after.inbox[0].text).toBe("Sam added poster board for Maya (Sunday's science fair) to Saturday's 11:30 errand run after soccer.");

    // idempotent: a repeat confirm does not add a second credit
    const twice = await call("confirm_proposal", { proposal_id: p.structuredContent.proposal_id, confirmed: true });
    expect(twice.isError).toBeFalsy();
    const final = await (await fetch(`${BASE}/demo/state`)).json() as any;
    expect(final.inbox.length).toBe(1);
    expect(final.board.deed.count).toBe(1);
  });

  it("a confirm in the same turn as its question is refused", async () => {
    // Timing-based by design, so try a few fresh needs: on a slow machine one round trip can pass 1 s.
    let refused = false;
    for (let i = 0; i < 4 && !refused; i++) {
      const n = await call("add_need", { speaker: "Maya", item: `guard probe ${i}`, due: "Sunday" });
      const p = await call("propose_add_to_errand", { need_id: n.structuredContent.need_id, errand_id: "errand_sat_after_soccer", speaker: "Sam" });
      const early = await call("confirm_proposal", { proposal_id: p.structuredContent.proposal_id, confirmed: true });
      if (early.isError) {
        expect(early.content[0].text).toBe("Let me check with you first.");
        refused = true;
      }
    }
    expect(refused).toBe(true);
  });

  it("confirm with confirmed=false cancels and writes nothing", async () => {
    await call("whats_new_for_me", { speaker: "Sam" });
    const p = await call("propose_add_to_errand", { need_id: "need_posterboard", errand_id: "errand_sat_after_soccer" });
    await sleep(1100);
    const c = await call("confirm_proposal", { proposal_id: p.structuredContent.proposal_id, confirmed: false });
    expect(c.content[0].text).toBe("Okay, I won't change anything.");
    const state = await (await fetch(`${BASE}/demo/state`)).json() as any;
    expect(state.board.needs.find((n: any) => n.need_id === "need_posterboard").status).toBe("open");
    expect(state.inbox).toEqual([]);
  });

  it("deed of the week: no self-award, nothing to claim, and it is only ever computed by the server", async () => {
    // Maya schedules her own poster board: that is not a deed for anyone.
    const p = await call("propose_add_to_errand", { need_id: "need_posterboard", errand_id: "errand_sat_after_soccer", speaker: "Maya" });
    await call("whats_new_for_me", { speaker: "Priya" }); // does not touch this proposal
    await sleep(1100);
    const c = await call("confirm_proposal", { proposal_id: p.structuredContent.proposal_id, confirmed: true });
    expect(c.isError).toBeFalsy();
    expect(c.structuredContent.board.deed).toBeNull();
    // there is no tool that awards or claims a deed
    const { body } = await rpc("tools/list");
    expect(body.result.tools.map((t: any) => t.name).join(" ")).not.toMatch(/deed|award|claim|vote/);
  });

  it("unknown proposal is a speakable error", async () => {
    const r = await call("confirm_proposal", { proposal_id: "proposal_999", confirmed: true });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("That request timed out. Want me to try again?");
  });

  it("mark_done by fuzzy item name and by id", async () => {
    const byName = await call("mark_done", { item: "got the poster board" });
    expect(byName.structuredContent.status).toBe("done");
    expect(byName.structuredContent.board.needs.find((n: any) => n.need_id === "need_posterboard")).toBeUndefined();
    const byId = await call("mark_done", { need_id: "need_dishsoap" });
    expect(byId.structuredContent.status).toBe("done");
    const missing = await call("mark_done", { item: "unicorn" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toBe("I couldn't find that item. Try saying the item name again.");
  });

  it("reset restores the seed and the demo clock", async () => {
    await call("mark_done", { item: "dish soap" });
    await reset();
    const state = await (await fetch(`${BASE}/demo/state`)).json() as any;
    expect(state.board.needs.length).toBe(3);
    expect(state.board.as_of_iso).toBe("2026-10-23T18:30:00-04:00");
  });

  it("/demo serves the card and /demo/log shows duration_ms", async () => {
    const page = await fetch(`${BASE}/demo`);
    expect(page.headers.get("content-type")).toContain("text/html");
    await call("list_errands", {});
    await sleep(100);
    const log = (await (await fetch(`${BASE}/demo/log`)).json()) as any;
    expect(log.log.at(-1)).toMatchObject({ tool: "list_errands", is_error: false });
    expect(typeof log.log.at(-1).duration_ms).toBe("number");
  });
});
