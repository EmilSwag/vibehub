// The text a user pastes straight into their AI tool to connect the VibeHub
// tracker without touching a terminal themselves — see round-5 plan (meta/plans/
// vibehub-round5-polish.md). `cursor` and `claude-code` are agentic coding tools
// that can run shell commands on the user's behalf; `chatgpt` (the default
// consumer product) can't, so it gets a walk-the-user-through-it version instead
// of an instruction to run things itself.

export type ConnectPromptTarget = "cursor" | "claude-code" | "chatgpt";

export type InstallOs = "mac" | "windows";

const STATUS_CMD = "node ~/.vibehub/app/vibehub-tracker.cjs status";

/**
 * Every prompt ends with this so the assistant (or the user, for ChatGPT) has
 * one unambiguous pass/fail check — the same output the Home panel then mirrors.
 */
export const VERIFY_LINE = `Run: ${STATUS_CMD} — it must print Connected: yes and a Seeing: line listing the tools it detects.`;

/**
 * The install one-liner for one OS. Sets VIBEHUB_API_URL explicitly so the
 * command works against any deployment (prod, a local dev server, staging) —
 * not just install.sh/.ps1's baked-in default. Shared by the prompt and the
 * "Do it manually" block so the two never drift.
 */
export function buildInstallCommand(os: InstallOs, token: string, apiUrl: string, webUrl: string): string {
  return os === "windows"
    ? `$env:VIBEHUB_TOKEN="${token}"; $env:VIBEHUB_API_URL="${apiUrl}"; irm ${webUrl}/tracker/install.ps1 | iex`
    : `curl -fsSL ${webUrl}/tracker/install.sh | VIBEHUB_API_URL="${apiUrl}" bash -s -- ${token}`;
}

/** Builds the prompt for `target`. */
export function buildConnectPrompt(target: ConnectPromptTarget, token: string, apiUrl: string, webUrl: string): string {
  const bash = buildInstallCommand("mac", token, apiUrl, webUrl);
  const ps1 = buildInstallCommand("windows", token, apiUrl, webUrl);

  if (target === "chatgpt") {
    return [
      "I'm connecting the VibeHub tracker on my machine. You can't run commands here, so walk me through it one step at a time:",
      "",
      "1. Ask whether I'm on macOS/Linux or Windows.",
      "2. Give me only the matching command below and ask me to run it in my own terminal, then paste back what it printed:",
      `   - macOS/Linux: ${bash}`,
      `   - Windows (PowerShell): ${ps1}`,
      '3. Then ask me to run the check below and paste its output. Tell me plainly whether it says "Connected: yes". If it says the token was rejected, or anything else, help me fix that from what it actually printed — don\'t guess or assume it worked.',
      "",
      VERIFY_LINE,
    ].join("\n");
  }

  return [
    "Connect the VibeHub tracker on this machine:",
    "",
    "1. Detect whether this machine is macOS/Linux or Windows.",
    "2. Run the matching command yourself:",
    `   - macOS/Linux: ${bash}`,
    `   - Windows (PowerShell): ${ps1}`,
    "3. Confirm it worked. If the output reports a rejected token or anything else, tell me exactly what it printed — don't guess or assume it worked.",
    "",
    VERIFY_LINE,
  ].join("\n");
}
