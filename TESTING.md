# Testing Kitchen Table (for judges)

Three ways to check it, from no setup to a full local run. None needs an account or a secret.

## 1. Look at the live board (no setup, 1 minute)

https://kitchen-table-mcp.wolfejam2020.workers.dev/demo

This is the real card the server returns (an MCP Apps `ui://kitchen-table/board` resource), polling every second: the household's needs, the errand runs, the weekend strip, Priya's phone and the Deed of the week. Two read-only JSON views sit beside it:

- `/demo/state`: the board data and Priya's inbox
- `/demo/log`: the last tool calls, with `duration_ms` (and `turn_gap_ms` on confirms)

`POST /mcp` needs a bearer token and answers `401` with **no** `WWW-Authenticate` header, as the Alexa+ quickstart requires. Because the live deployment is one shared household, driving its tools would change what the next person sees, so the hands-on route below runs it on your own machine.

## 2. Run it and play the story (5 minutes)

Needs Node 20 or newer and Python 3 (built and tested on Node 24).

```bash
git clone https://github.com/Wolfe-Jam/kitchen-table && cd kitchen-table
npm install
cp .dev.vars.example .dev.vars          # sets a demo token and admin secret
npm run dev                              # http://127.0.0.1:8787
```

In a second terminal, in the same folder:

```bash
export KT_URL=http://127.0.0.1:8787 MCP_TOKEN=change-me-demo-token ADMIN_SECRET=change-me-admin-secret
scripts/kt tools                                          # the six tools
scripts/kt whats_new_for_me '{"speaker":"Sam"}'           # Friday evening: "anything I should know?"
scripts/kt yes                                            # Sam says yes: preview, wait a turn, confirm
scripts/kt log                                            # duration_ms per call
scripts/kt reset                                          # back to the start (demo clock: Fri Oct 23 2026, 6:30 PM ET)
```

Open http://127.0.0.1:8787/demo beside it. You should see:

1. `whats_new_for_me` → *Soccer AM is at 9 AM tomorrow. One more thing: Maya needs poster board for Sunday's science fair. Want me to add it to the 11:30 errand run after soccer?*
2. `yes` → a preview question, then *Done. Poster board is on Saturday's 11:30 errand run after soccer, and I let Priya know.*
3. The board: poster board under Saturday's run, tagged "from Maya"; Priya's phone shows the nudge; the gold **Deed of the week** bar names Sam.
4. `scripts/kt log`: each call a few milliseconds locally (the quickstart's limit is 500 ms) and the confirm shows its `turn_gap_ms`.

To call the tools another way, point the MCP Inspector (`npx @modelcontextprotocol/inspector`) at `http://127.0.0.1:8787/mcp` with the header `Authorization: Bearer change-me-demo-token`.

## 3. Run the test suite (1 minute)

```bash
npm test
```

It starts its own server on port 8799 with a built-in test token and runs 24 tests against the live `/mcp` endpoint:

- the three protocol versions (2025-11-25, 2025-06-18, 2025-03-26) and the fallback for an unknown one
- exactly six tools, `structuredContent` plus a speakable text copy on every result, and speakable `isError` messages
- `401` with no `WWW-Authenticate` header, for a missing and a wrong token
- the full story: propose writes nothing; a confirm in the same turn as its question is refused; the confirm then commits, nudges Priya and is idempotent
- the Deed of the week: no self-award, one credit per need, and no tool that awards, claims or votes
- tool-side latency under 500 ms

## What is real, and what is simulated

- **Real:** the MCP server, the household state (a Durable Object), the confirm guard, the board card, the tests.
- **Simulated:** the voice, and who is speaking. `speaker` is whatever the caller passes, so it is not an authentication boundary. A real deployment would take it from Alexa's voice identification.
- **Not built:** OAuth account linking (the quickstart requires it for real Alexa+ accounts), purchases, a live calendar. The household and its calendar are fictional seed data.

See `README.md` for the architecture and `FRICTION_LOG.md` for what worked and what didn't.
