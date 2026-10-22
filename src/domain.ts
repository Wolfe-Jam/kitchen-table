// Household domain model and the six tools. Pure logic: no I/O, no LLM calls.
// The Durable Object loads State, calls runTool, saves State.

import * as T from "./time";

export const HOUSEHOLD_ID = "hh_patel";
export const CARD_URI = "ui://kitchen-table/board";
/** The demo story is pinned to Fri Oct 23 2026, 6:30 PM ET unless reset says otherwise. */
export const DEFAULT_DEMO_NOW = "2026-10-23T18:30:00-04:00";
export const PROPOSAL_TTL_MS = 120_000;
/** A confirm this soon after the question being answered cannot be a real second turn. */
export const MIN_TURN_GAP_MS = 1000;

export interface Member {
  id: string;
  name: string;
  role: "parent" | "kid";
  aliases: string[];
}

export interface Need {
  id: string;
  owner: string;
  item: string;
  due_ms: number | null;
  note: string | null;
  status: "open" | "scheduled" | "done";
  errand_id: string | null;
  created_ms: number;
  heard_by: string[];
}

export interface Errand {
  id: string;
  label: string;
  speech: string;
  start_ms: number;
  base_items: string[];
  strip: boolean;
}

export interface CalEvent {
  id: string;
  label: string;
  start_ms: number;
  end_ms: number;
}

export interface Proposal {
  id: string;
  need_id: string;
  errand_id: string;
  proposer: string | null;
  created_ms: number;
  question_ms: number;
  status: "pending" | "confirmed" | "cancelled";
}

export interface InboxEntry {
  id: string;
  to: string;
  text: string;
  at_ms: number;
}

export interface State {
  household_id: string;
  now_override: string | null;
  members: Member[];
  needs: Need[];
  errands: Errand[];
  events: CalEvent[];
  proposals: Proposal[];
  inbox: InboxEntry[];
  history: { at_ms: number; text: string }[];
  /** need_id -> real wall-clock ms when whats_new_for_me last offered it */
  suggested: Record<string, number>;
  counters: { need: number; proposal: number; inbox: number };
  last_speaker: string | null;
  highlight: string | null;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface Notification {
  to_id: string;
  to_name: string;
  text: string;
}

export interface ToolOutput {
  result: ToolResult;
  notify: Notification[];
}

// ---------- clock + seed ----------

export function clock(state: State, realNow: number): number {
  return state.now_override ? Date.parse(state.now_override) : realNow;
}

export function seed(realNow: number, nowOverride: string | null): State {
  const now = nowOverride ? Date.parse(nowOverride) : realNow;
  const todayYmd = T.today(now);
  const sat = T.dateOfNext(now, 6, false);
  const sun = T.addDays(sat, 1);
  const wed = T.addDays(sat, 4);
  const at = (d: T.Ymd, h: number, mi = 0) => T.nyMs(d.y, d.m, d.d, h, mi);
  const yesterday = T.addDays(todayYmd, -1);

  return {
    household_id: HOUSEHOLD_ID,
    now_override: nowOverride,
    members: [
      { id: "member_sam", name: "Sam", role: "parent", aliases: ["sam", "dad", "daddy", "father"] },
      { id: "member_priya", name: "Priya", role: "parent", aliases: ["priya", "mom", "mommy", "mum", "mother"] },
      { id: "member_maya", name: "Maya", role: "kid", aliases: ["maya", "kid", "son", "daughter", "child"] },
    ],
    needs: [
      {
        id: "need_posterboard", owner: "member_maya", item: "poster board",
        due_ms: at(sun, 10), note: "science fair", status: "open", errand_id: null,
        created_ms: at(yesterday, 16, 12), heard_by: ["member_maya"],
      },
      {
        id: "need_dishsoap", owner: "member_priya", item: "dish soap",
        due_ms: null, note: null, status: "open", errand_id: null,
        created_ms: at(todayYmd, 7, 40), heard_by: ["member_priya"],
      },
      {
        id: "need_registration", owner: "member_sam", item: "car registration renewal",
        due_ms: at(wed, 17), note: null, status: "open", errand_id: null,
        created_ms: at(T.addDays(todayYmd, -2), 9), heard_by: ["member_sam"],
      },
    ],
    errands: [
      {
        id: "errand_sat_after_soccer",
        label: "Saturday 11:30 AM (after soccer): Target + hardware store",
        speech: "11:30 errand run after soccer",
        start_ms: at(sat, 11, 30),
        base_items: ["lightbulbs", "dog food"],
        strip: true,
      },
      {
        id: "errand_sun",
        label: "Sunday after lunch: groceries",
        speech: "errand run after lunch on Sunday",
        start_ms: at(sun, 13, 30),
        base_items: ["groceries"],
        strip: false,
      },
    ],
    events: [
      { id: "event_soccer_am", label: "Soccer AM", start_ms: at(sat, 9), end_ms: at(sat, 11) },
      { id: "event_sun", label: "Science Fair, Lunch, Learn, Leisure", start_ms: at(sun, 10), end_ms: at(sun, 18) },
    ],
    proposals: [],
    inbox: [],
    history: [],
    suggested: {},
    counters: { need: 0, proposal: 0, inbox: 0 },
    last_speaker: null,
    highlight: null,
  };
}

// ---------- small helpers ----------

const member = (s: State, id: string) => s.members.find((m) => m.id === id);
const nameOf = (s: State, id: string) => member(s, id)?.name ?? "someone";
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function resolveMember(s: State, raw: unknown): Member | null {
  const q = String(raw ?? "").trim().toLowerCase();
  if (!q) return null;
  return s.members.find((m) => m.id === q || m.aliases.includes(q) || m.name.toLowerCase() === q) ?? null;
}

const STOP = new Set(["the", "a", "an", "my", "our", "got", "bought", "picked", "up", "done", "i", "we", "have", "it", "for", "some"]);
const tokens = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

function fuzzyNeeds(s: State, query: string): Need[] {
  const q = tokens(query);
  if (!q.length) return [];
  const scored = s.needs
    .filter((n) => n.status !== "done")
    .map((n) => {
      const hay = tokens(n.item);
      return { n, score: q.filter((w) => hay.some((h) => h.includes(w) || w.includes(h))).length };
    })
    .filter((x) => x.score > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.score));
  return scored.filter((x) => x.score === best).map((x) => x.n);
}

/** "poster board for Sunday's science fair" */
function needPhrase(n: Need, now: number): string {
  if (n.due_ms === null) return n.item;
  const day = T.dayLabel(n.due_ms, now);
  return n.note ? `${n.item} for ${day}'s ${n.note}` : `${n.item} for ${day}`;
}

function errandDay(e: Errand): string {
  return `${T.weekdayName(e.start_ms)}'s`;
}

function suggestErrand(s: State, n: Need, now: number): Errand | null {
  const ok = s.errands
    .filter((e) => e.start_ms > now && (n.due_ms === null || e.start_ms <= n.due_ms))
    .sort((a, b) => a.start_ms - b.start_ms);
  return ok[0] ?? null;
}

const byDue = (a: Need, b: Need) => {
  if (a.due_ms === null && b.due_ms === null) return a.created_ms - b.created_ms;
  if (a.due_ms === null) return 1;
  if (b.due_ms === null) return -1;
  return a.due_ms - b.due_ms || a.created_ms - b.created_ms;
};

// ---------- board (what the card renders) ----------

export function board(s: State, realNow: number, highlight: string | null = s.highlight) {
  const now = clock(s, realNow);
  const needs = s.needs
    .filter((n) => n.status !== "done")
    .sort(byDue)
    .map((n) => {
      const errand = n.errand_id ? s.errands.find((e) => e.id === n.errand_id) : undefined;
      return {
        need_id: n.id,
        owner: n.owner,
        owner_name: nameOf(s, n.owner),
        item: n.item,
        due_iso: n.due_ms === null ? null : T.isoNY(n.due_ms),
        due_label: n.due_ms === null ? null : `${T.weekdayShort(n.due_ms)} ${T.timeLabel(n.due_ms)}`,
        note: n.note,
        status: n.status,
        errand_id: n.errand_id,
        errand_label: errand ? errand.speech : null,
      };
    });
  const errands = [...s.errands]
    .sort((a, b) => a.start_ms - b.start_ms)
    .map((e) => ({
      errand_id: e.id,
      label: e.label,
      speech: e.speech,
      start_iso: T.isoNY(e.start_ms),
      day: T.weekdayName(e.start_ms),
      items: [
        ...e.base_items.map((label) => ({ label })),
        ...s.needs
          .filter((n) => n.errand_id === e.id && n.status !== "done")
          .map((n) => ({ label: n.item, need_id: n.id, from: nameOf(s, n.owner) })),
      ],
    }));
  const strip = [
    ...s.events.map((e) => ({ id: e.id, start_ms: e.start_ms, label: e.label })),
    ...s.errands.filter((e) => e.strip).map((e) => ({ id: e.id, start_ms: e.start_ms, label: `${T.timeLabel(e.start_ms).replace(" AM", "").replace(" PM", "")} errands` })),
  ]
    .sort((a, b) => a.start_ms - b.start_ms)
    .map((x) => ({ id: x.id, day: T.weekdayShort(x.start_ms), time: T.timeLabel(x.start_ms), label: x.label }));
  return {
    household: s.household_id,
    as_of_iso: T.isoNY(now),
    needs,
    errands,
    strip,
    highlight_need_id: highlight,
  };
}

// ---------- tool plumbing ----------

const META = { ui: { resourceUri: CARD_URI, invoking: "Checking the kitchen table…", invoked: "Here's the board" } };

function ok(text: string, sc: Record<string, unknown>, card = true): ToolOutput {
  const result: ToolResult = { content: [{ type: "text", text }], structuredContent: sc };
  if (card) result._meta = META;
  return { result, notify: [] };
}

function err(text: string): ToolOutput {
  return { result: { content: [{ type: "text", text }], isError: true }, notify: [] };
}

const WHO_ERR = "I didn't catch who is speaking. Tell me your name.";

// ---------- tools ----------

export function runTool(s: State, name: string, args: Record<string, unknown>, realNow: number): ToolOutput {
  const now = clock(s, realNow);
  switch (name) {
    case "add_need": return addNeed(s, args, now, realNow);
    case "whats_new_for_me": return whatsNew(s, args, now, realNow);
    case "list_errands": return listErrands(s, args, now, realNow);
    case "propose_add_to_errand": return propose(s, args, now, realNow);
    case "confirm_proposal": return confirm(s, args, now, realNow);
    case "mark_done": return markDone(s, args, now, realNow);
    default: return err("I don't know that one.");
  }
}

function addNeed(s: State, a: Record<string, unknown>, now: number, realNow: number): ToolOutput {
  const m = resolveMember(s, a.speaker);
  if (!m) return err(WHO_ERR);
  const item = String(a.item ?? "").trim();
  if (!item) return err("What do you need? Say the item name.");
  let note = typeof a.note === "string" && a.note.trim() ? a.note.trim() : null;
  let due: number | null = null;
  if (typeof a.due === "string" && a.due.trim()) {
    due = T.parseDue(a.due, now);
    if (due === null && !note) note = a.due.replace(/^(for|by)\s+(the\s+)?/i, "").trim() || null;
  }
  s.last_speaker = m.id;
  const dup = s.needs.find((n) => n.owner === m.id && n.item.toLowerCase() === item.toLowerCase() && n.status !== "done");
  const need: Need = dup ?? {
    id: `need_${++s.counters.need}`, owner: m.id, item, due_ms: due, note,
    status: "open", errand_id: null, created_ms: now, heard_by: [m.id],
  };
  if (!dup) s.needs.push(need);
  s.highlight = need.id;
  const text = dup
    ? `I already have ${needPhrase(need, now)} on the list, ${m.name}.`
    : `Got it, ${m.name}. ${cap(needPhrase(need, now))}. I'll make sure someone knows.`;
  return ok(text, {
    need_id: need.id, owner: m.id, owner_name: m.name, item: need.item,
    due_iso: need.due_ms === null ? null : T.isoNY(need.due_ms), status: need.status,
    board: board(s, realNow),
  });
}

function whatsNew(s: State, a: Record<string, unknown>, now: number, realNow: number): ToolOutput {
  const m = resolveMember(s, a.speaker);
  if (!m) return err(WHO_ERR);
  const limit = Math.min(5, Math.max(1, Number.isInteger(a.limit) ? (a.limit as number) : 3));
  const cands = s.needs
    .filter((n) => n.status === "open" && n.owner !== m.id && !n.heard_by.includes(m.id))
    .sort(byDue);
  const top = cands.slice(0, limit);
  const more = cands.length - top.length;
  const items = top.map((n) => {
    const e = suggestErrand(s, n, now);
    return {
      need_id: n.id, owner: n.owner, owner_name: nameOf(s, n.owner), item: n.item,
      due_iso: n.due_ms === null ? null : T.isoNY(n.due_ms),
      suggested_errand_id: e?.id ?? null, suggested_errand_label: e?.speech ?? null,
    };
  });
  for (const n of top) {
    n.heard_by.push(m.id);
    s.suggested[n.id] = realNow;
  }
  s.last_speaker = m.id;

  const next = s.events.filter((e) => e.start_ms > now).sort((a, b) => a.start_ms - b.start_ms)[0];
  const next_event = next
    ? { event_id: next.id, label: next.label, start_iso: T.isoNY(next.start_ms) }
    : null;

  const lines: string[] = [];
  if (next) {
    const when = T.dayLabel(next.start_ms, now);
    lines.push(`${next.label} is at ${T.timeLabel(next.start_ms)} ${when === "today" || when === "tomorrow" ? when : `on ${when}`}.`);
  }
  const first = top[0];
  if (first) {
    const lead = next ? "One more thing: " : "";
    lines.push(`${lead}${nameOf(s, first.owner)} needs ${needPhrase(first, now)}.`);
    const e = items[0].suggested_errand_label;
    if (e) lines.push(`Want me to add it to the ${e}?`);
  } else {
    lines.unshift("Nothing new from the others right now.");
  }
  return ok(lines.join(" "), {
    items, next_event, more,
    board: board(s, realNow),
  });
}

function dayMatches(e: Errand, q: string, now: number): boolean {
  const s = q.toLowerCase();
  if (/soccer/.test(s)) return /soccer/.test(e.speech.toLowerCase());
  if (/weekend/.test(s)) return [0, 6].includes(T.parts(e.start_ms).wd);
  if (/today/.test(s)) return T.sameDay(e.start_ms, now);
  if (/tomorrow/.test(s)) return T.dayDiff(e.start_ms, now) === 1;
  const wd = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].findIndex((d) => s.includes(d));
  if (wd >= 0) return T.parts(e.start_ms).wd === wd;
  return true;
}

function listErrands(s: State, a: Record<string, unknown>, now: number, realNow: number): ToolOutput {
  const q = typeof a.day === "string" ? a.day.trim() : "";
  const b = board(s, realNow);
  const upcoming = s.errands.filter((e) => e.start_ms > now - 3 * 3600_000).sort((x, y) => x.start_ms - y.start_ms);
  const picked = (q ? upcoming.filter((e) => dayMatches(e, q, now)) : upcoming).slice(0, 5);
  const view = b.errands.filter((e) => picked.some((p) => p.id === e.errand_id));
  const text = picked.length
    ? view.map((e) => `${e.day}, ${e.speech}: ${e.items.slice(0, 5).map((i) => i.label).join(", ") || "nothing yet"}.`).join(" ")
    : "I don't see an errand run for that.";
  return ok(text, { errands: view, board: b });
}

function propose(s: State, a: Record<string, unknown>, now: number, realNow: number): ToolOutput {
  const need = s.needs.find((n) => n.id === a.need_id);
  if (!need) return err("I couldn't find that item. Try saying the item name again.");
  if (need.status === "done") return err("That one is already handled.");
  if (need.status === "scheduled") return err("That one is already on an errand run.");
  const errand = s.errands.find((e) => e.id === a.errand_id);
  if (!errand) return err("I couldn't find that errand run.");
  const proposer = resolveMember(s, a.speaker)?.id ?? s.last_speaker ?? need.owner;
  const others = s.members.filter((m) => m.role === "parent" && m.id !== proposer).map((m) => m.name);
  const id = `proposal_${++s.counters.proposal}`;
  s.proposals.push({
    id, need_id: need.id, errand_id: errand.id, proposer,
    created_ms: realNow, question_ms: s.suggested[need.id] ?? realNow, status: "pending",
  });
  const summary = `Add ${need.item} for ${nameOf(s, need.owner)} to ${errandDay(errand)} ${errand.speech}${others.length ? `, and let ${others.join(" and ")} know` : ""}?`;
  return ok(summary, {
    proposal_id: id, need_id: need.id, errand_id: errand.id, summary,
    requires_confirmation: true, expires_in_s: PROPOSAL_TTL_MS / 1000,
  }, false);
}

function confirm(s: State, a: Record<string, unknown>, now: number, realNow: number): ToolOutput {
  const p = s.proposals.find((x) => x.id === a.proposal_id);
  if (!p) return err("That request timed out. Want me to try again?");
  const need = s.needs.find((n) => n.id === p.need_id)!;
  const errand = s.errands.find((e) => e.id === p.errand_id)!;

  if (p.status === "confirmed") {
    return ok(`Already done. ${cap(need.item)} is on ${errandDay(errand)} ${errand.speech}.`, {
      need_id: need.id, errand_id: errand.id, status: need.status, notified: [], board: board(s, realNow),
    });
  }
  if (p.status === "cancelled" || realNow - p.created_ms > PROPOSAL_TTL_MS) {
    return err("That request timed out. Want me to try again?");
  }
  if (a.confirmed !== true) {
    p.status = "cancelled";
    return ok("Okay, I won't change anything.", { need_id: need.id, errand_id: errand.id, status: need.status, notified: [], board: board(s, realNow) }, false);
  }
  const gap = realNow - p.question_ms;
  if (gap < MIN_TURN_GAP_MS) return err("Let me check with you first.");

  p.status = "confirmed";
  need.status = "scheduled";
  need.errand_id = errand.id;
  s.highlight = need.id;
  const proposer = p.proposer ?? need.owner;
  const recipients = s.members.filter((m) => m.role === "parent" && m.id !== proposer);
  const detail = need.due_ms !== null && need.note
    ? `${need.item} for ${nameOf(s, need.owner)} (${T.dayLabel(need.due_ms, now)}'s ${need.note})`
    : `${need.item} for ${nameOf(s, need.owner)}`;
  const text = `${nameOf(s, proposer)} added ${detail} to ${errandDay(errand)} ${errand.speech}.`;
  s.history.push({ at_ms: now, text });
  const notify: Notification[] = recipients.map((r) => {
    s.inbox.push({ id: `msg_${++s.counters.inbox}`, to: r.id, text, at_ms: now });
    return { to_id: r.id, to_name: r.name, text };
  });
  const names = recipients.map((r) => r.name);
  const spoken = `Done. ${cap(need.item)} is on ${errandDay(errand)} ${errand.speech}${names.length ? `, and I let ${names.join(" and ")} know` : ""}.`;
  const out = ok(spoken, {
    need_id: need.id, errand_id: errand.id, status: "scheduled",
    notified: recipients.map((r) => r.id), turn_gap_ms: gap, board: board(s, realNow),
  });
  out.notify = notify;
  return out;
}

function markDone(s: State, a: Record<string, unknown>, now: number, realNow: number): ToolOutput {
  let need: Need | undefined;
  if (typeof a.need_id === "string" && a.need_id) {
    need = s.needs.find((n) => n.id === a.need_id);
  } else if (typeof a.item === "string" && a.item.trim()) {
    const hits = fuzzyNeeds(s, a.item);
    if (hits.length > 1) {
      return err(`Which one: ${hits.slice(0, 5).map((h) => h.item).join(", ")}?`);
    }
    need = hits[0];
  } else {
    return err("Which item is done? Say the item name.");
  }
  if (!need) return err("I couldn't find that item. Try saying the item name again.");
  if (need.status === "done") {
    return ok(`${cap(need.item)} was already marked done.`, { need_id: need.id, status: "done", board: board(s, realNow, null) });
  }
  need.status = "done";
  s.highlight = null;
  s.history.push({ at_ms: now, text: `${need.item} marked done` });
  return ok(`Marked ${need.item} as done.`, { need_id: need.id, status: "done", board: board(s, realNow, null) });
}
