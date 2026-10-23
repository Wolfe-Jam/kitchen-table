# Alexa+ MCP toolkit and hackathon tooling friction log

Template: [chris-trag/friction-log-guide](https://github.com/chris-trag/friction-log-guide). Live document, started at the first commit.

| Reviewer | Status |
| :--- | :--- |
| **James Wolfe** (with Claude Code) | Complete |
| **Amazon Alexa+ / Developer Relations** | Under review |

## BLUF (bottom line up front)

A spec-conformant remote MCP server for Alexa+ was quick to build from the quickstart, but the quickstart is silent on the tool-result shape, MCP Apps rendering and speech limits, and it leaves OAuth discovery unclear without `WWW-Authenticate`. AWS account verification and the Kiro sign-in blocked the AWS tools for most of a one-day build. Kiro CLI worked only late on the last night (via the device flow), so our Kiro use is small: a read-only code review and two tests.

**Grade:** B−

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
- [x] Use Kiro on part of the build (late: a read-only review and two tests)
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

### Amazon, AWS and hackathon tooling

### Kiro CLI sign-in fails with "Token exchange failed" on a new AWS account

**Severity:** 🔥 Critical

**Timestamp:** 2026-10-22 ~02:30 local, Kiro CLI 2.33.1 desktop sign-in

**Expected:** Sign in with Google, GitHub or Builder ID and start using the CLI.

**Actual:** Every option ends in: `Unified auth portal failed: Authentication failed: The identity provider reported an error: Token exchange failed: {"message":"There was an error signing in. Please contact Support ... Reference: b4e854b8-f001-70bc-b65c-e46b1e85bec8"}`. `kiro-cli whoami` reports "Not logged in". The same account was, at that moment, waiting on AWS identity verification (driving licence and proof of address), so the cause may be that, but the error does not say so. Reproduced from a second client: `kiro-cli login` in a terminal fails with the same message and the **same reference ID**, so the failure follows the sign-in identity, not the app or the machine. `kiro-cli login --use-device-flow` is interactive and prints nothing without a terminal, so a coding agent cannot start the device flow.

**Recommendation:** Name the actual cause in the error (for example "account verification pending"), and make `kiro-cli login --use-device-flow` print the code and URL in non-interactive shells.

**Update, 2026-10-22 ~23:00 local:** the AWS console now let us in (no verification email had arrived). `kiro-cli login` (browser flow) then ended on a page saying "You can close this window now", yet `kiro-cli whoami` still said "Not logged in" and the CLI showed no error. `kiro-cli login --use-device-flow`, run in an interactive terminal, printed a code and URL and succeeded ("Logged in successfully", Builder ID). So the default browser flow can fail silently while the device flow works. Suggestion: show the result in the CLI when the browser flow cannot complete, and mention the device flow as the fallback.

### AWS account identity verification and sign-in blocked the AWS tools for a one-day build

**Severity:** ⚠️ High

**Timestamp:** 2026-10-22, from the evening AWS sign-up (no recording)

**Expected:** Sign up, get a working account, and try Bedrock, the Alexa+ bridge and Kiro the same evening.

**Actual:** Sign-up was followed by an identity verification step (photo ID and proof of address) with a stated wait of under 24 hours, usually 2 to 3 hours. At the time of writing no confirmation email has arrived. The console home opened, but `aws login` from the CLI did not complete: the browser sign-in page asked for an account ID or IAM user and did not accept it (it was unclear whether to choose the root user instead), and a first attempt timed out waiting for browser approval. The AWS CLI also had to be installed by hand (a package manager would have built it from source on this Mac). Net effect: Bedrock, AgentCore, the alexa-skill-mcp-bridge and Kiro could not be tried before the deadline, so the AWS Builder challenge is not claimed.

**Recommendation:** Show verification status and an estimated time on the console home. Let a new account use a limited Bedrock/AgentCore sandbox while verification runs. On the `aws login` sign-in page, say plainly "root user" versus "IAM user" and what each one needs.

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

### How an MCP Apps card reaches a screen is not documented in the quickstart

**Severity:** ⚡ Medium

**Timestamp:** 2026-10-22, from the bridge README (not tried)

**Expected:** `_meta.ui.resourceUri` leads to a card on the device or simulator, and the quickstart says how.

**Actual:** The quickstart does not say how Alexa+ renders an MCP Apps card. We first read an older bridge README that put visual output out of scope. The current README (re-read the same night) says the bridge renders the server's MCP Apps widget to a still image on devices with a screen, behind `visual.enabled`, added in the bridge's PRs #8 and #9 on 2026-10-18. We could not run the bridge (AWS access never cleared), so we have not verified it, and the card is shown on `/demo` instead.

**Recommendation:** Say in the quickstart whether and when Alexa+ itself renders MCP Apps, and how a developer previews it.

### Other tools we used (not Amazon)

Kept for completeness; these are not Amazon products.

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

### Narration: a human voice was inconsistent, Grok Voice made it consistent

**Severity:** ⚡ Medium

**Timestamp:** 2026-10-22, evening (the demo video's soundtrack)

**Expected:** Record a short narration and a few character lines, and have them sound like one coherent film.

**Actual:** Recorded line by line on an iMac's built-in mic, the narration varied from line to line (tone, level, room sound), and caption-sized fragments sounded choppy rather than like one story. The recordings were quiet, so an automatic silence-trimmer cut the soft final "s" of "needs", and the Stop-button click survived trimming. The character voices (Sam in particular) were generated in separate sessions and drifted between takes. It took several rounds of retakes, re-trimming and re-rendering.

**Fix:** One flowing script, then every voice generated in a single batch with Grok Voice: one fixed voice and speed per speaker (Eve for Maya, Atlas for Sam, Ara for Alexa, Rex for the narrator), delivered as consistent 44.1 kHz mono files at about -16 LUFS with clean sentence pauses. That removed the variation, and the batch's even pauses let captions be timed to each sentence.

**Notes:** Sam's speed had to be 0.70, which Grok says is as slow as its API goes, to fit a 1.6 to 2.0 second line. We label the voices as simulated on screen. This entry is about our own tooling, not an Amazon product.

**Recommendation:** For a demo with several voices, generate them all in one batch with fixed voice settings from the start, instead of recording or generating line by line.

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
6. Show AWS account verification status and an ETA, and offer a limited Bedrock/AgentCore sandbox while it runs (see the AWS entry).

## Video timestamps

| Time | Event |
| :--- | :--- |
| 1:20 | The 401 with no `WWW-Authenticate` header, as the quickstart requires (first Alexa+ entry below) |
| 1:35 | The friction log and the honest limits: OAuth not built, the AWS tools not used |

## Screen recording

- Demo video: https://youtu.be/vGV_YJFv-p8. No full-session screen recording was made; the two working-software segments replay real output captured from the live server.

## Test environment

- OS: macOS 13 (Darwin 22.6.0)
- Device/Emulator: `wrangler dev` (workerd) and Cloudflare Workers + Durable Objects (SQLite-backed); Alexa simulator and Echo not yet used
- SDK/API version tested: MCP spec 2025-11-25 (also 2025-06-18, 2025-03-26); wrangler 4.151.3; vitest 3.2
- Editor: Claude Code in a terminal
- Runtime versions: Node 24

## What succeeded

- ✅ Worker + SQLite-backed Durable Object, six tools, card, `/demo`, `/admin/reset`
- ✅ Deployed to https://kitchen-table-mcp.wolfejam2020.workers.dev
- ✅ 26/26 live-endpoint tests pass locally and against the deployed URL (protocol versions, 401 with no `WWW-Authenticate`, confirm guard, idempotent confirm, inbox nudge, tool-side latency under 500 ms)

## What failed

- ✅ Kiro CLI (late, after the device-flow login): a read-only review of `src/` listed three risks; we checked each against the code and none was a defect. Kiro then wrote two regression tests (Accept negotiation, notification 202 with an empty body), which pass locally and against the live URL. It changed no other file.
- ❌ Kiro earlier: sign-in failed for most of the build (see Friction), so it shaped none of the design
- ❌ AWS account: identity verification still pending at the time of writing; Bedrock, AgentCore and the bridge not tried
- ❌ Not attempted: bridge + AgentCore + Nova (AWS account verification pending), Alexa simulator run, real Echo

## Appendix

### Products covered (one section each as they are used)

Alexa+ MCP docs ✅ · alexa-skill-mcp-bridge · Bedrock AgentCore / Strands / Nova 2 Lite · Kiro · Alexa console / simulator · Cloudflare Workers + Durable Objects · MCP Inspector · Grok Voice (video voices)

### Scratch pad

```
[00:53 local] npm install → wrangler 4.151 / workers-types 4.x → ERESOLVE peer conflict → 5 min
[00:57 local] vitest → process.env.BASE_URL === "/" → "Failed to parse URL from //admin/reset" → 3 min
[00:5x local] WebFetch devpost /rules → 403 → read via Chrome instead → 5 min
[01:0x local] bridge README → needs AWS creds + Nova 2 Lite access in us-east-1 + Docker/Finch + CDK bootstrap + public URL; (an older README said no MCP Apps rendering; the current one renders the widget to an image, not tried)
```
