// Starts `wrangler dev` for the suite unless KT_BASE_URL points at an already-running server.
import { spawn, type ChildProcess } from "node:child_process";

const PORT = 8799;
let child: ChildProcess | undefined;

export async function setup() {
  if (process.env.KT_BASE_URL) return;
  child = spawn(
    "npx",
    ["wrangler", "dev", "--port", String(PORT), "--persist-to", ".wrangler-test", "--var", "MCP_TOKEN:test-token", "--var", "ADMIN_SECRET:test-admin"],
    { stdio: "ignore", detached: false },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("wrangler dev did not start within 60s");
}

export async function teardown() {
  child?.kill("SIGTERM");
}
