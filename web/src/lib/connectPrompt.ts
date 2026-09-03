// The text a user pastes straight into their AI tool to connect the VibeHub
// tracker without touching a terminal themselves — see round-5 plan (meta/plans/
// vibehub-round5-polish.md). `cursor` and `claude-code` are agentic coding tools
// that can run shell commands on the user's behalf; `chatgpt` (the default
// consumer product) can't, so it gets a walk-the-user-through-it version instead
// of an instruction to run things itself.

export type ConnectPromptTarget = "cursor" | "claude-code" | "chatgpt";

const STATUS_CMD = "node ~/.vibehub/app/vibehub-tracker.cjs status";

function installCommands(token: string, apiUrl: string, webUrl: string): string[] {
  return [
    `macOS/Linux:  curl -fsSL ${webUrl}/tracker/install.sh | VIBEHUB_API_URL="${apiUrl}" bash -s -- ${token}`,
    `Windows (PowerShell):  $env:VIBEHUB_TOKEN="${token}"; $env:VIBEHUB_API_URL="${apiUrl}"; irm ${webUrl}/tracker/install.ps1 | iex`,
  ];
}

/**
 * Builds the prompt for `target`. The install one-liners set VIBEHUB_API_URL
 * explicitly so the generated command works against any deployment (prod, a
 * local dev server, staging) — not just install.sh/.ps1's baked-in default.
 */
export function buildConnectPrompt(target: ConnectPromptTarget, token: string, apiUrl: string, webUrl: string): string {
  const [bash, ps1] = installCommands(token, apiUrl, webUrl);

  if (target === "chatgpt") {
    return [
      "I'm connecting the VibeHub tracker on my machine. You can't run commands here, so walk me through it one step at a time:",
      "",
      "1. Ask whether I'm on macOS/Linux or Windows.",
      "2. Give me only the matching command below and ask me to run it in my own terminal, then paste back what it printed:",
      `   - macOS/Linux: ${bash}`,
      `   - Windows (PowerShell): ${ps1}`,
      "3. Once I've pasted the output, ask me to also run this and paste its output:",
      `   ${STATUS_CMD}`,
      '4. Tell me plainly whether that output says "Connected: yes". If it says the token was rejected, or anything else, help me fix that from what it actually printed — don\'t guess or assume it worked.',
    ].join("\n");
  }

  return [
    "Connect the VibeHub tracker on this machine:",
    "",
    "1. Detect whether this machine is macOS/Linux or Windows.",
    "2. Run the matching command yourself:",
    `   - macOS/Linux: ${bash}`,
    `   - Windows (PowerShell): ${ps1}`,
    "3. Then run this to confirm it actually worked:",
    `   ${STATUS_CMD}`,
    '4. Confirm the output says "Connected: yes." If it instead reports a rejected token or anything else, tell me exactly what it printed — don\'t guess or assume it worked.',
  ].join("\n");
}
