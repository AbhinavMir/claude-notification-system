import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Send an iMessage via Messages.app using AppleScript.
// `to` is a phone number (+1...) or Apple ID email.
export async function sendIMessage(to, text) {
  const script = `
on run argv
  set theTarget to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set theBuddy to participant theTarget of targetService
    send theText to theBuddy
  end tell
end run`;
  await run("osascript", ["-e", script, to, text]);
}
