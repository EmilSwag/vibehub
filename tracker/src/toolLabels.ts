import type { StatusSource } from "./types";

/** Human labels for the tool ids the adapters emit (see adapters/processes.ts RULES). */
const TOOL_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  vscode: "VS Code",
  windsurf: "Windsurf",
  zed: "Zed",
  quadcode: "Quadcode AI",
  chatgpt: "ChatGPT",
  grok: "Grok",
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

/**
 * "Claude Code (claude-fable-5-1, claude-opus-5), Cursor" — one entry per tool,
 * in first-seen order (the input is most-recent-first), models listed raw so
 * they can be matched 1:1 against what the profile shows.
 */
export function describeSources(sources: StatusSource[]): string {
  const byTool = new Map<string, string[]>();
  for (const s of sources) {
    const models = byTool.get(s.tool) ?? [];
    if (s.model && !models.includes(s.model)) models.push(s.model);
    byTool.set(s.tool, models);
  }
  return [...byTool.entries()]
    .map(([tool, models]) => (models.length ? `${toolLabel(tool)} (${models.join(", ")})` : toolLabel(tool)))
    .join(", ");
}
