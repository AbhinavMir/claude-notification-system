---
name: reach-me
description: Use when you need to ask the user a question, get a decision, or report that work is done by actually messaging and phoning them. Triggers on "call me", "phone me", "ask me out loud", "let me know when done by calling", or any moment you'd otherwise block waiting on the user while they're away from the keyboard.
---

# Reach the user by message + phone call

This skill is backed by the `claude-notification-system` MCP server. Use its tools to
contact the user through iMessage and a Retell phone call instead of just printing text
they may not see.

## When to use

- You finished a task and want to confirm next steps: call with
  "Hi, Cladia here, just finished the work. Anything else I should do?"
- You hit a decision you can't make yourself: call with the full question.
- The user said "call me when…" or "ask me by phone."

## How to use

1. Call **`reach_me`** with `prompt` set to the **entire** thing to say — it is spoken
   verbatim. Write it as natural speech, e.g.
   `"Hello, Cladia calling from your computer, I had a quick question. <your question>"`.
   - It texts the user first, then phones them.
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
