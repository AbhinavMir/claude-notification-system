// Client used by the per-session MCP server to talk to the shared daemon.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const DAEMON_PORT = Number(process.env.NOTIFY_DAEMON_PORT || 8788);
const BASE = `http://127.0.0.1:${DAEMON_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function healthy() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}

// Ensure the shared daemon is running; spawn it detached if not. Safe to call
// concurrently from many sessions — the loser of the port race just exits.
export async function ensureDaemon() {
  if (await healthy()) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Log to a file so a detached daemon is still debuggable after the spawning
  // session is gone.
  const logPath = path.join(os.tmpdir(), "claude-notification-daemon.log");
  const out = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [path.join(here, "daemon.js")], {
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  for (let i = 0; i < 30; i++) {
    if (await healthy()) return;
    await sleep(500);
  }
  throw new Error("daemon did not become healthy in time");
}

// Poll the daemon for a specific call_id until it completes or we time out.
export async function pollResult(callId, timeoutMs, intervalMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/result/${encodeURIComponent(callId)}`);
      const j = await r.json();
      if (j.status === "completed") {
        return { status: "completed", call_id: callId, transcript: j.transcript };
      }
    } catch {
      // daemon momentarily unreachable; keep trying
    }
    await sleep(intervalMs);
  }
  return { status: "pending", call_id: callId, transcript: null };
}

export async function fetchResult(callId) {
  try {
    const r = await fetch(`${BASE}/result/${encodeURIComponent(callId)}`);
    return await r.json();
  } catch {
    return { status: "pending" };
  }
}

export async function fetchInbound() {
  try {
    const r = await fetch(`${BASE}/inbound`);
    return await r.json();
  } catch {
    return [];
  }
}
