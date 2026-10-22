# Alexa+ MCP toolkit and hackathon tooling friction log

Template: [chris-trag/friction-log-guide](https://github.com/chris-trag/friction-log-guide). Live document, started at the first commit.

| Reviewer | Status |
| :--- | :--- |
| **James Wolfe** (with Claude Code) | In progress |
| **Amazon Alexa+ / Developer Relations** | Under review |

## BLUF (bottom line up front)

*(Fill Thursday late.)* Building a spec-conformant remote MCP server for Alexa+ is straightforward from the quickstart, but the quickstart says nothing about the tool result shape, MCP Apps rendering, or speech limits, and the track rules page blocks automated reading.

**Grade:** TBD

## Persona

- **Role:** Solo developer, TypeScript, building for a hackathon in about 30 hours
- **Experience with this product:** First time with Alexa+ add-ons and the MCP toolkit
- **Goal:** Ship a self-hosted MCP server ("Kitchen Table") that holds household state across people and days, returns an MCP Apps card, and runs the demo through Alexa+ or a simulator
- **Technical context:** Clean repo, Cloudflare Workers + Durable Objects, macOS 13, Node 24

## Scope

- [x] Read the Alexa+ MCP quickstart and implement its hard requirements (protocol version, Streamable HTTP, 401 rule, latency)
- [x] Build and deploy six tools with `structuredContent` plus speakable text
- [x] Build an MCP Apps card
- [ ] Run the demo through the alexa-skill-mcp-bridge (Alexa developer console simulator)
- [ ] Use Kiro on part of the build
- [ ] Run the demo on an Echo / Echo Show

## Pros

- The quickstart states the hard requirements plainly: protocol `2025-11-25`, Streamable HTTP, `<500 ms` round trip, PKCE `S256`, `resource` parameter.
- The addon.json field table lists every limit (name 30, short description 123, 3–4 example phrases).
- The hackathon rules say clearly that a self-hosted MCP server on spec 2025-11-25 qualifies, and name what counts as "creative" for the track.

## Cons

- The quickstart is silent on the tool result shape, the MCP Apps resource and MIME type, `_meta.ui` fields, and any speech or response length limits.
- It lists `WWW-Authenticate` under "Not supported yet" while requiring OAuth discovery.
- The rules page cannot be read by an automated fetch.
- `addon.json` needs store-listing assets a demo build cannot reasonably have.

## Friction

### The quickstart says `WWW-Authenticate` is "not supported yet", which blocks standard OAuth discovery

**Severity:** ⚠️ High

**Timestamp:** 2026-10-22, while reading the quickstart (no recording yet)

**Expected:** Standard MCP auth (RFC 9728) finds the protected resource metadata through the `WWW-Authenticate` header on a 401.

**Actual:** The quickstart requires `401 Unauthorized` *without* a `WWW-Authenticate` header and lists that header under "Not supported yet". Discovery has to come from the well-known PRM URL alone.

**Recommendation:** State how Alexa+ finds the PRM URL when the header is absent, and say whether the header will be supported later.

### The Devpost rules page returns HTTP 403 to an automated fetch

**Severity:** ⚠️ High

**Timestamp:** 2026-10-22

**Expected:** An agent can read the track rules to confirm what qualifies.

**Actual:** `403 Forbidden` for `https://amazonappdev2026.devpost.com/rules` through an automated fetch. Reading it through a real browser worked and settled track fit.

**Recommendation:** Put the track requirements somewhere crawlable, or repeat them in the quickstart.

### `addon.json` needs assets a demo build cannot reasonably have

**Severity:** ⚡ Medium

**Timestamp:** 2026-10-22

**Expected:** A minimal manifest for a demo.

**Actual:** Required: privacy and terms URLs, six light-icon sizes, and a 600x900 carousel image. This repo ships real privacy and terms URLs and placeholder image URLs.

**Recommendation:** Allow a development manifest without store-listing assets.

### The bridge does not render MCP Apps cards

**Severity:** ⚡ Medium

**Timestamp:** 2026-10-22, from the bridge README (not yet tried)

**Expected:** `_meta.ui.resourceUri` leads to a card on the device or simulator.

**Actual:** The bridge README says visual output is out of scope for v1 (`visual` is always null; `_meta.ui.resourceUri` is preserved for later). The card is therefore shown on `/demo` instead. *To be confirmed once the bridge is run.*

**Recommendation:** Say in the quickstart whether and when Alexa+ itself renders MCP Apps, and how a developer previews it.

### wrangler 4.151 peer-depends on `@cloudflare/workers-types` 5.x

**Severity:** ⚡ Medium

**Timestamp:** 2026-10-22 ~00:53 local, `npm install`

**Expected:** `wrangler@^4` with `workers-types@^4` installs.

**Actual:** `ERESOLVE ... Conflicting peer dependency: @cloudflare/workers-types@5.20261022.1`. Fixed by moving to `^5.20261019.1`. About 5 minutes lost.

**Recommendation:** (Cloudflare, not Amazon.) Pin a compatible range in the Workers templates.

### Vitest overwrites `process.env.BASE_URL` with `/`

**Severity:** ℹ️ Low

**Timestamp:** 2026-10-22 ~00:57 local

**Expected:** A test helper reads its own `BASE_URL`.

**Actual:** It got `/` (Vite's own value), giving `Failed to parse URL from //admin/reset`. Renamed to `KT_BASE_URL`. About 3 minutes lost.

**Recommendation:** None for Amazon; recorded for completeness.

## Questions

- Open Source mini challenge: the rules say "new, additional" project or a contribution alongside the primary entry. Does the main repo count, or does it need a separate repo or PR?
- What MIME type and `_meta` keys does Alexa+ expect for the MCP Apps card?
- Is there a stated speech length limit? (The 30 s / 75 word rule in this project's spec is not on the quickstart page.)
- How does Alexa+ find the PRM URL without `WWW-Authenticate`?

## Recommendations

1. Document the tool result shape and speech limits in the quickstart.
2. Say how OAuth discovery works without `WWW-Authenticate`.
3. Make the rules page readable by automated tools.
4. Allow a development `addon.json` without store assets.
5. State whether Alexa+ renders MCP Apps and how to preview them.

## Video timestamps

| Time | Event |
| :--- | :--- |
| 00:00:00 | *(fill after recording)* |

## Screen recording

- Full session: *(add link)*

## Test environment

- OS: macOS 13 (Darwin 22.6.0)
- Device/Emulator: `wrangler dev` (workerd) and Cloudflare Workers + Durable Objects (SQLite-backed); Alexa simulator and Echo not yet used
- SDK/API version tested: MCP spec 2025-11-25 (also 2025-06-18, 2025-03-26); wrangler 4.151.3; vitest 3.2
- Editor: Claude Code in a terminal
- Runtime versions: Node 24

## What succeeded

- ✅ Worker + SQLite-backed Durable Object, six tools, card, `/demo`, `/admin/reset`
- ✅ Deployed to https://kitchen-table-mcp.wolfejam2020.workers.dev
- ✅ 22/22 live-endpoint tests pass locally and against the deployed URL (protocol versions, 401 with no `WWW-Authenticate`, confirm guard, idempotent confirm, inbox nudge, tool-side latency under 500 ms)

## What failed

- ❌ Not yet attempted: bridge + AgentCore + Nova, Alexa simulator run, real Echo, Kiro

## Appendix

### Products covered (one section each as they are used)

Alexa+ MCP docs ✅ · alexa-skill-mcp-bridge · Bedrock AgentCore / Strands / Nova 2 Lite · Kiro · Alexa console / simulator · Cloudflare Workers + Durable Objects · MCP Inspector

### Scratch pad

```
[00:53 local] npm install → wrangler 4.151 / workers-types 4.x → ERESOLVE peer conflict → 5 min
[00:57 local] vitest → process.env.BASE_URL === "/" → "Failed to parse URL from //admin/reset" → 3 min
[00:5x local] WebFetch devpost /rules → 403 → read via Chrome instead → 5 min
[01:0x local] bridge README → needs AWS creds + Nova 2 Lite access in us-east-1 + Docker/Finch + CDK bootstrap + public URL; no MCP Apps rendering
```
