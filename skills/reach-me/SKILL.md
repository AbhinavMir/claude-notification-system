---
name: reach-me
description: Use when you need to ask the user a question, get a decision, or report that work is done by actually messaging and phoning them. Triggers on "call me", "phone me", "ask me out loud", "let me know when done by calling", or any moment you'd otherwise block waiting on the user while they're away from the keyboard.
---

# Reach the user by message + phone call

This skill is backed by the `claude-notification-system` MCP server. Use its tools to
contact the user through iMessage and a Retell phone call instead of just printing text
they may not see.

## HARD RULE — only call the MCP tool

ONLY reach the user by invoking the **`reach_me` MCP tool**. NEVER write, copy, or run your
own script, driver, or node file (e.g. a `reach_driver.mjs`) that imports this project's
modules or calls Retell/ngrok directly.

The MCP server is already running and owns the webhook tunnel (port 8787). A second process
cannot bind that port — your driver will silently fall back to "place call only" and
**throw away the transcript**, so you'll act on a guess instead of the user's real answer.
The `reach_me` tool reuses the running server's tunnel and returns the transcript inline.
If the tool isn't available, the server isn't loaded — restart the session; do NOT build a
workaround.

## When to use

**Call the user whenever you hit a problem you can't resolve on your own** instead of
guessing, stalling, or silently giving up. Specifically:

- You're blocked: missing credential, ambiguous instruction, a decision only the user can
  make, or an error you can't get past after a real attempt.
- You need approval for something irreversible or outward-facing.
- You finished a task and want next steps: "Hi, Cladia here, just finished the work.
  Anything else I should do?"
- The user said "call me when…" or "ask me by phone."

Don't call for trivia you can figure out yourself. Call when you'd otherwise be stuck.

## How to use

1. Call **`reach_me`** with `prompt` set to the **entire** thing to say. Pick a `channel`:
   - `channel: "call"` (default) — texts then phones, waits for the spoken reply, returns
     the transcript. Use when you're blocked and need a decision/answer.
   - `channel: "text"` — sends only the iMessage and returns immediately. Use for a
     heads-up/FYI ("done with X", "kicked off the build") you don't need a reply to.
   - For a call, write the prompt as natural speech, e.g.
     `"Hello, Cladia calling from your computer, I had a quick question. <your question>"`.
   - A call texts the user first, then phones them.
   - A battery warning is appended automatically when the laptop is unplugged — do not
     add one yourself.
   - It blocks until the call ends (up to 5 min) and returns the transcript. Read the
     transcript for the user's instructions and then **do what they said.**
2. If `reach_me` returns `{"status":"pending"}` (timeout), call **`get_result`** with the
   returned `call_id` to fetch the transcript once available.
3. To see if the user called *in*, call **`get_pending_messages`**; act on any transcripts.

## Notes

- The user's spoken instructions are authoritative — carry them out, then if appropriate
  `reach_me` again to confirm completion.
- Keep prompts conversational and short; it's a phone call, not an essay.
