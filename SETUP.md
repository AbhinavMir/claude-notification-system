# Setup

## 1. Install (macOS, Node 18+)

Register the MCP server with Claude Code — `npx` fetches it from npm on first run:

```bash
claude mcp add claude-notification-system -- npx -y claude-notification-system
```

## 2. Configure

Create `~/.config/claude-notification-system/.env`:

```bash
mkdir -p ~/.config/claude-notification-system
cat > ~/.config/claude-notification-system/.env <<'EOF'
RETELL_API_KEY=your_retell_key
RETELL_AGENT_ID=agent_xxx
RETELL_FROM_NUMBER=+1xxxxxxxxxx     # a Retell-registered number
MY_PHONE_NUMBER=+1xxxxxxxxxx        # where to call/text you
IMESSAGE_HANDLE=+1xxxxxxxxxx        # optional; defaults to MY_PHONE_NUMBER
NGROK_AUTHTOKEN=your_ngrok_token
EOF
```

(You can instead pass these as `env` in the MCP server config — real env vars win over the file.)

## 3. Retell agent

Create an agent in Retell whose prompt uses the dynamic variable `{{your_question}}`. Minimal template:

```
You are Cladia, calling on behalf of the user's computer.
Say exactly this, then have a natural conversation:

{{your_question}}

Listen to the user's reply. If they give instructions, confirm you understood them,
then say goodbye and end the call. Keep it short — this is a quick phone call.
```

- `RETELL_FROM_NUMBER` must be registered in Retell for outbound calls.
- For inbound: point that Retell number at this same agent. Inbound transcripts are
  queued for the `get_pending_messages` tool.

## 4. macOS permissions

First call will prompt to let your terminal / Claude Code control **Messages.app**
(System Settings → Privacy & Security → Automation). Approve it, or the iMessage step
is skipped (the phone call still happens).

## 5. Use

Ask Claude to "call me" / "let me know by phone when done". It calls the `reach_me` tool,
which texts you, phones you, waits for your answer, and acts on it.
