#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";

import { powerStatus } from "./power.js";
import { sendIMessage } from "./imessage.js";
import { placeCall } from "./retell.js";
import {
  ensureDaemon,
  pollResult,
  fetchResult,
  fetchInbound,
} from "./daemon-client.js";

// Config resolution order (later loads do NOT override already-set vars):
//   1. Real env vars (e.g. passed via the MCP server's `env` block) — highest priority
//   2. NOTIFY_ENV_FILE, if set
//   3. ~/.config/claude-notification-system/.env  (the distributable default)
//   4. ~/Code/easyPCR/.env  (author's local fallback)
for (const p of [
  process.env.NOTIFY_ENV_FILE,
  `${process.env.HOME}/.config/claude-notification-system/.env`,
  `${process.env.HOME}/Code/easyPCR/.env`,
]) {
  if (p) dotenv.config({ path: p, override: false });
}

const cfg = {
  retellApiKey: process.env.RETELL_API_KEY,
  agentId: process.env.RETELL_AGENT_ID,
  fromNumber: process.env.RETELL_FROM_NUMBER,
  myPhone: process.env.MY_PHONE_NUMBER,
  imessageHandle: process.env.IMESSAGE_HANDLE || process.env.MY_PHONE_NUMBER,
  ngrokAuthtoken: process.env.NGROK_AUTHTOKEN,
  ngrokDomain: process.env.NGROK_DOMAIN,
  callTimeoutMs: Number(process.env.CALL_TIMEOUT_MS || 5 * 60 * 1000),
};

// The tunnel/webhook now lives in a single shared daemon (daemon.js). This
// server just makes sure it's up and then talks to it over localhost.

const server = new Server(
  { name: "claude-notification-system", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: "reach_me",
    description:
      "Reach the user. With channel \"call\" (default): iMessage the prompt, then call via Retell speaking it, block until the call ends (up to 5 min), and return the transcript with the user's instructions (or a call_id if it times out). With channel \"text\": just send the iMessage and return immediately — no call, no waiting. Use \"text\" for a heads-up/FYI you don't need an answer to; use \"call\" when you're blocked and need a decision. Adds a battery note automatically when the laptop is unplugged.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The full message/question to text and speak to the user.",
        },
        channel: {
          type: "string",
          enum: ["call", "text"],
          description: "\"call\" (default) texts then phones and waits for a reply; \"text\" only sends the iMessage and returns immediately.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "get_result",
    description:
      "Fetch the transcript of a call that reach_me returned as 'pending' (timed out). Pass the call_id.",
    inputSchema: {
      type: "object",
      properties: { call_id: { type: "string" } },
      required: ["call_id"],
    },
  },
  {
    name: "get_pending_messages",
    description:
      "Return transcripts of any inbound calls the user made to the Retell agent since the last check. Call this to see if the user reached out.",
    inputSchema: { type: "object", properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    if (name === "reach_me") {
      const basePrompt = String(args?.prompt || "").trim();
      if (!basePrompt) throw new Error("prompt is required");
      const channel = args?.channel === "text" ? "text" : "call";

      // Text-only needs just an iMessage handle; calling needs the full stack.
      const required =
        channel === "text"
          ? ["imessageHandle"]
          : ["retellApiKey", "agentId", "fromNumber", "myPhone", "ngrokAuthtoken"];
      const missing = required.filter((k) => !cfg[k]);
      if (missing.length) {
        throw new Error(
          `Missing config: ${missing.join(", ")}. Set them as env vars or in ` +
            `~/.config/claude-notification-system/.env (see README).`
        );
      }

      const power = await powerStatus();
      const spoken = power.phrase ? `${basePrompt} ${power.phrase}` : basePrompt;

      // Text-only: send the iMessage and return, no call.
      if (channel === "text") {
        await sendIMessage(cfg.imessageHandle, spoken);
        return {
          content: [
            { type: "text", text: JSON.stringify({ status: "texted", channel: "text" }, null, 2) },
          ],
        };
      }

      // Make sure the shared webhook daemon is running (spawns it if not).
      // Non-fatal: if it won't come up we still place the call, just without a
      // transcript to poll for.
      let daemonUp = true;
      try {
        await ensureDaemon();
      } catch (e) {
        daemonUp = false;
        console.error("daemon unavailable, placing call without transcript:", e.message);
      }

      // 1) iMessage first
      try {
        await sendIMessage(cfg.imessageHandle, spoken);
      } catch (e) {
        // Messaging failure shouldn't block the call; report it inline.
        console.error("iMessage failed:", e.message);
      }

      // 2) Place the call — call_id uniquely ties this call to this session.
      const callId = await placeCall(cfg.retellApiKey, {
        fromNumber: cfg.fromNumber,
        toNumber: cfg.myPhone,
        agentId: cfg.agentId,
        prompt: spoken,
      });

      // 3) Poll the shared daemon for THIS call_id's transcript.
      if (!daemonUp) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "pending",
                  call_id: callId,
                  note: "Call placed, but the webhook daemon isn't reachable, so the transcript can't be read here. The user was still phoned. Retry get_result later.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
      const outcome = await pollResult(callId, cfg.callTimeoutMs);
      return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }] };
    }

    if (name === "get_result") {
      const j = await fetchResult(String(args?.call_id || ""));
      return { content: [{ type: "text", text: JSON.stringify(j, null, 2) }] };
    }

    if (name === "get_pending_messages") {
      const items = await fetchInbound();
      return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${err.message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("claude-notification-system MCP running on stdio");
