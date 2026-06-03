import express from "express";
import ngrok from "@ngrok/ngrok";

// Holds state for in-flight outbound calls and received inbound calls.
const pending = new Map(); // call_id -> { resolve, transcript, done }
const results = new Map(); // call_id -> transcript (for get_result safety net)
const inboundQueue = []; // [{ call_id, transcript, at }]

// Register an outbound call we're waiting on. Returns a promise that resolves
// with the transcript when Retell reports the call ended/analyzed.
export function awaitCall(callId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(callId)) {
        pending.delete(callId);
        resolve({ status: "pending", call_id: callId, transcript: null });
      }
    }, timeoutMs);
    pending.set(callId, {
      resolve: (transcript) => {
        clearTimeout(timer);
        resolve({ status: "completed", call_id: callId, transcript });
      },
    });
  });
}

export function getResult(callId) {
  return results.get(callId) ?? null;
}

export function drainInbound() {
  const items = inboundQueue.splice(0, inboundQueue.length);
  return items;
}

function handleEvent(body) {
  const event = body?.event;
  const call = body?.call ?? {};
  const callId = call.call_id;
  if (!callId) return;

  // We only act on terminal events that carry a transcript.
  if (event !== "call_ended" && event !== "call_analyzed") return;

  const transcript =
    call.transcript ||
    call.call_analysis?.transcript ||
    call.call_analysis?.call_summary ||
    "(no transcript)";

  results.set(callId, transcript);

  if (pending.has(callId)) {
    const entry = pending.get(callId);
    pending.delete(callId);
    entry.resolve(transcript);
    return;
  }

  // Not something we initiated -> inbound call. Queue it for Claude to pick up.
  if (call.direction === "inbound") {
    inboundQueue.push({ call_id: callId, transcript, at: new Date().toISOString() });
  }
}

// Starts the express server + ngrok tunnel. Returns the public webhook URL.
// Pass `ngrokDomain` (a reserved ngrok domain) for a stable URL across restarts.
export async function startWebhook({ port, ngrokAuthtoken, ngrokDomain }) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.get("/health", (_req, res) => res.send("ok"));
  app.post("/webhook", (req, res) => {
    try {
      handleEvent(req.body);
    } catch {
      // never let a bad payload crash the tunnel
    }
    res.sendStatus(200);
  });

  // Bind an ephemeral port (0). ngrok forwards the reserved DOMAIN to whatever
  // local port we land on, so there's no need for a fixed port — and no
  // EADDRINUSE collision when multiple Claude Code sessions each spawn their own
  // copy of this server. The `port` arg is ignored (kept for compatibility).
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, () => resolve(s));
    s.on("error", reject); // surface bind errors instead of crashing the process
  });
  const localPort = server.address().port;

  const listener = await ngrok.connect({
    addr: localPort,
    authtoken: ngrokAuthtoken,
    ...(ngrokDomain ? { domain: ngrokDomain } : {}),
  });
  return `${listener.url()}/webhook`;
}
