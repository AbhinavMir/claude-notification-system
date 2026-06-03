import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Returns { pluggedIn: boolean, phrase: string|null }.
// `phrase` is a spoken/written aside to append only when on battery.
export async function powerStatus() {
  try {
    const { stdout } = await run("pmset", ["-g", "batt"]);
    // Line looks like: "Now drawing from 'AC Power'" or "'Battery Power'"
    const pluggedIn = /AC Power/i.test(stdout);
    return {
      pluggedIn,
      phrase: pluggedIn
        ? null
        : "Heads up, the laptop is running on battery, not plugged in.",
    };
  } catch {
    // pmset only exists on macOS; if it fails, don't block the call.
    return { pluggedIn: true, phrase: null };
  }
}
