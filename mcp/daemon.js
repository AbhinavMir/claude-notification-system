#!/usr/bin/env node
// Shared, long-lived webhook daemon. ONE of these runs per machine. It owns the
// single ngrok tunnel + Retell webhook and stores call results keyed by call_id.
// Every per-session MCP server talks to it over localhost instead of opening its
// own tunnel — so sessions never fight over the port or the ngrok domain, and a
// transcript is always retrievable by the call_id that placed it.
import express from "express";
import ngrok from "@ngrok/ngrok";
import dotenv from "dotenv";
import { setAgentWebhook } from "./retell.js";

for (const p of [
  process.env.NOTIFY_ENV_FILE,
  `${process.env.HOME}/.config/claude-notification-system/.env`,
  `${process.env.HOME}/Code/easyPCR/.env`,
]) {
  if (p) dotenv.config({ path: p, override: false });
}

const DAEMON_PORT = Number(process.env.NOTIFY_DAEMON_PORT || 8788);
const cfg = {
  retellApiKey: process.env.RETELL_API_KEY,
  agentId: process.env.RETELL_AGENT_ID,
  ngrokAuthtoken: process.env.NGROK_AUTHTOKEN,
  ngrokDomain: process.env.NGROK_DOMAIN,
};

const results = new Map(); // call_id -> transcript
const inboundQueue = []; // [{ call_id, transcript, at }]
let webhookUrl = null;

function handleEvent(body) {
  const event = body?.event;
  const call = body?.call ?? {};
  const callId = call.call_id;
  if (!callId) return;
  if (event !== "call_ended" && event !== "call_analyzed") return;

  const transcript =
    call.transcript ||
    call.call_analysis?.transcript ||
    call.call_analysis?.call_summary ||
    "(no transcript)";
  results.set(callId, transcript);

  if (call.direction === "inbound") {
    inboundQueue.push({ call_id: callId, transcript, at: new Date().toISOString() });
  }
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, webhookUrl }));

app.post("/webhook", (req, res) => {
  try {
    handleEvent(req.body);
  } catch {
    // never let a bad payload crash the daemon
  }
  res.sendStatus(200);
});

// A session polls this with the exact call_id it placed — correct transcript,
// right session, every time.
app.get("/result/:callId", (req, res) => {
  const t = results.get(req.params.callId);
  res.json(t ? { status: "completed", transcript: t } : { status: "pending" });
});

app.get("/inbound", (_req, res) => {
  const items = inboundQueue.splice(0, inboundQueue.length);
  res.json(items);
});

const server = app.listen(DAEMON_PORT, async () => {
  console.error(`daemon listening on 127.0.0.1:${DAEMON_PORT}`);
  try {
    const listener = await ngrok.connect({
      addr: DAEMON_PORT,
      authtoken: cfg.ngrokAuthtoken,
      ...(cfg.ngrokDomain ? { domain: cfg.ngrokDomain } : {}),
    });
    webhookUrl = `${listener.url()}/webhook`;
    console.error("daemon webhook URL:", webhookUrl);
    // Best-effort: published Retell agents reject this, so the webhook should be
    // set once in the dashboard to the (stable) ngrok domain. Non-fatal either way.
    try {
      await setAgentWebhook(cfg.retellApiKey, cfg.agentId, webhookUrl);
    } catch (e) {
      console.error("setAgentWebhook skipped:", e.message);
    }
  } catch (e) {
    console.error("ngrok tunnel failed:", e.message);
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    // Another daemon already owns the port — that's the whole point. Exit quietly.
    console.error(`daemon already running on ${DAEMON_PORT}; exiting`);
    process.exit(0);
  }
  console.error("daemon error:", e.message);
  process.exit(1);
});
