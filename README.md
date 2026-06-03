# claude-notification-system

An MCP server (packaged as a Claude Code plugin) that lets Claude **reach you for real**:
it texts you on iMessage, then calls your phone via Retell, speaks a prompt, listens to
your answer, and hands the transcript back to Claude so it can do what you said. It tells
you when the laptop is on battery, and it answers inbound calls too.

## What it does

- `reach_me(prompt)` — iMessage you, place a Retell call speaking `prompt`, block until the
  call ends, return the transcript. Appends a battery note when unplugged.
- `get_result(call_id)` — fetch a transcript if `reach_me` timed out.
- `get_pending_messages()` — transcripts of calls **you** placed to the agent.

Webhooks reach your laptop through a built-in **ngrok** tunnel. Every Claude Code session
spawns its own copy of this MCP server, so the tunnel does **not** live in the server —
it lives in a single shared **daemon** (`daemon.js`, on `127.0.0.1:8788`) that the first
call auto-starts and all sessions share. Each session places its call, gets a unique
`call_id`, and polls the daemon for that id's transcript — so calls from different sessions
never cross, and there's only ever one tunnel/one ngrok domain in use.

## Install (npm, one line)

```bash
claude mcp add claude-notification-system -- npx -y claude-notification-system
```

`npx` fetches the package from npm and runs the stdio server. Full setup —
config file, Retell agent template, macOS permissions — is in [SETUP.md](SETUP.md).

### Configure

The server resolves config in this order (real env vars win):

1. Env vars (e.g. an `env` block in the MCP config)
2. `NOTIFY_ENV_FILE`, if set
3. `~/.config/claude-notification-system/.env`  ← the standard location

Keys: `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_FROM_NUMBER`, `MY_PHONE_NUMBER`,
`IMESSAGE_HANDLE` (optional), `NGROK_AUTHTOKEN`. See [`.env.example`](.env.example).

### Retell agent setup

- The agent's prompt must include the dynamic variable `{{your_question}}` — that's where
  the spoken prompt is injected.
- `RETELL_FROM_NUMBER` must be a number registered in Retell for outbound calls.
- For inbound, point your Retell phone number at this agent; the server's webhook (set
  automatically on startup) will queue inbound transcripts for `get_pending_messages`.

## Requirements

- macOS (uses `pmset` for battery and Messages.app for iMessage).
- Node 18+.
- Messages.app signed in to iMessage; Terminal/Claude Code allowed to control it
  (System Settings → Privacy & Security → Automation).
