// MCP server surface: tool definitions, input validation, JSON-RPC handling.

import { CARD_HTML, CARD_MIME } from "./card";
import { CARD_URI } from "./domain";

export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SERVER_INFO = { name: "kitchen-table", title: "Kitchen Table", version: "1.0.0" };

interface Prop {
  type: "string" | "integer" | "boolean";
  description: string;
  minimum?: number;
  maximum?: number;
}
interface Schema {
  type: "object";
  required?: string[];
  properties: Record<string, Prop>;
}

const SPEAKER: Prop = {
  type: "string",
  description:
    "Who is speaking. Household member name or id, e.g. 'Maya', 'Sam', 'Priya'. Synonyms: dad, mom, kid, son, daughter are resolved against the household. Not verified: this is whatever the caller passes.",
};

const cardMeta = { ui: { resourceUri: CARD_URI } };

export const TOOLS: {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  annotations: Record<string, boolean>;
  _meta?: Record<string, unknown>;
}[] = [
  {
    name: "add_need",
    title: "Add a need",
    description: "Remember something a household member needs, with an optional due date.",
    inputSchema: {
      type: "object",
      required: ["speaker", "item"],
      properties: {
        speaker: SPEAKER,
        item: { type: "string", description: "The thing needed, e.g. 'poster board'. Synonyms: stuff, supplies, thing for school." },
        due: { type: "string", description: "When it's needed. ISO date or words like 'Sunday', 'tomorrow', 'by the weekend', 'end of week'. Resolved in America/New_York." },
        note: { type: "string", description: "Optional reason, e.g. 'science fair', 'soccer'." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    _meta: cardMeta,
  },
  {
    name: "whats_new_for_me",
    title: "What's new for me",
    description:
      "Brief the speaker on open needs from other household members that they haven't heard yet. Marks the returned items as heard by the speaker. Does not change any errand.",
    inputSchema: {
      type: "object",
      required: ["speaker"],
      properties: {
        speaker: SPEAKER,
        limit: { type: "integer", description: "How many items to return, 1 to 5. Default 3.", minimum: 1, maximum: 5 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    _meta: cardMeta,
  },
  {
    name: "list_errands",
    title: "List errands",
    description: "List upcoming errand runs and what's on each. At most 5.",
    inputSchema: {
      type: "object",
      properties: {
        day: { type: "string", description: "Optional filter: 'Saturday', 'after soccer', 'this weekend', 'today', 'tomorrow'." },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    _meta: cardMeta,
  },
  {
    name: "propose_add_to_errand",
    title: "Preview adding a need to an errand",
    description: "Preview adding a need to an errand run. Does not change anything. Returns a proposal_id to pass to confirm_proposal after the speaker says yes.",
    inputSchema: {
      type: "object",
      required: ["need_id", "errand_id"],
      properties: {
        need_id: { type: "string", description: "A need_ id from whats_new_for_me." },
        errand_id: { type: "string", description: "An errand_ id from whats_new_for_me or list_errands." },
        speaker: { ...SPEAKER, description: "Optional. Who is proposing; defaults to the last person who spoke." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "confirm_proposal",
    title: "Confirm a proposal",
    description:
      "Carry out a proposal the speaker just confirmed, and notify the other parent. Only call this after the speaker has answered yes in their own reply, never in the same turn as the question. confirmed=true for yes/yeah/sure/do it; false for no/cancel/never mind.",
    inputSchema: {
      type: "object",
      required: ["proposal_id", "confirmed"],
      properties: {
        proposal_id: { type: "string", description: "A proposal_ id from propose_add_to_errand." },
        confirmed: { type: "boolean", description: "true if the speaker said yes, false if they said no or cancel." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    _meta: cardMeta,
  },
  {
    name: "mark_done",
    title: "Mark a need done",
    description: "Mark a need as handled or bought. Give need_id, or the item name (synonyms: got it, bought, picked up, done).",
    inputSchema: {
      type: "object",
      properties: {
        need_id: { type: "string", description: "A need_ id." },
        item: { type: "string", description: "The item name, e.g. 'poster board'." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    _meta: cardMeta,
  },
];

/** Returns a short speakable problem, or null when the args fit the schema. */
export function validate(schema: Schema, args: Record<string, unknown>): string | null {
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") return `I need the ${key.replace(/_/g, " ")}.`;
  }
  for (const [key, p] of Object.entries(schema.properties)) {
    const v = args[key];
    if (v === undefined || v === null) continue;
    if (p.type === "string" && typeof v !== "string") return `The ${key} should be text.`;
    if (p.type === "boolean" && typeof v !== "boolean") return `The ${key} should be yes or no.`;
    if (p.type === "integer") {
      if (typeof v !== "number" || !Number.isInteger(v)) return `The ${key} should be a whole number.`;
      if (p.minimum !== undefined && v < p.minimum) return `The ${key} should be at least ${p.minimum}.`;
      if (p.maximum !== undefined && v > p.maximum) return `The ${key} should be at most ${p.maximum}.`;
    }
  }
  return null;
}

export function negotiate(requested: unknown): string {
  return typeof requested === "string" && SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
}

export const RESOURCES = [
  {
    uri: CARD_URI,
    name: "Kitchen Table board",
    description: "Echo Show card: needs, errand runs and the weekend strip.",
    mimeType: CARD_MIME,
  },
];

export function readResource(uri: string) {
  if (uri !== CARD_URI) return null;
  return { contents: [{ uri, mimeType: CARD_MIME, text: CARD_HTML }] };
}

export async function argsHash(args: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(args ?? {}));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest).slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
