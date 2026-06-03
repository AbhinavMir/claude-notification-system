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
import { placeCall, setAgentWebhook } from "./retell.js";
import {
  startWebhook,
  awaitCall,
  getResult,
  drainInbound,
} from "./webhook.js";

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
  port: Number(process.env.NOTIFY_PORT || 8787),
  callTimeoutMs: Number(process.env.CALL_TIMEOUT_MS || 5 * 60 * 1000),
};

let webhookReady = null; // promise; lazy-start the tunnel on first call

async function ensureWebhook() {
  if (!webhookReady) {
    webhookReady = (async () => {
      const url = await startWebhook({
        port: cfg.port,
        ngrokAuthtoken: cfg.ngrokAuthtoken,
        ngrokDomain: cfg.ngrokDomain,
      });
      console.error("Retell webhook URL (set this in the Retell dashboard):", url);
      // Published Retell agents reject webhook updates; that's fine — the call
      // still goes through, we just can't auto-point the webhook here. Set it
      // once in the Retell dashboard (account or agent webhook = this ngrok URL)
      // to get transcripts back instead of relying on the timeout fallback.
      try {
        await setAgentWebhook(cfg.retellApiKey, cfg.agentId, url);
      } catch (e) {
        console.error("setAgentWebhook skipped:", e.message);
      }
      return url;
    })();
  }
  return webhookReady;
}

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

      await ensureWebhook();

      // 1) iMessage first
      try {
        await sendIMessage(cfg.imessageHandle, spoken);
      } catch (e) {
        // Messaging failure shouldn't block the call; report it inline.
        console.error("iMessage failed:", e.message);
      }

      // 2) Place the call
      const callId = await placeCall(cfg.retellApiKey, {
        fromNumber: cfg.fromNumber,
        toNumber: cfg.myPhone,
        agentId: cfg.agentId,
        prompt: spoken,
      });

      // 3) Long-poll until the call ends or we time out
      const outcome = await awaitCall(callId, cfg.callTimeoutMs);
      return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }] };
    }

    if (name === "get_result") {
      const t = getResult(String(args?.call_id || ""));
      return {
        content: [
          {
            type: "text",
            text: t
              ? JSON.stringify({ status: "completed", transcript: t }, null, 2)
              : JSON.stringify({ status: "pending" }, null, 2),
          },
        ],
      };
    }

    if (name === "get_pending_messages") {
      const items = drainInbound();
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
