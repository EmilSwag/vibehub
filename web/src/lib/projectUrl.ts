/** A hostname wins over ambiguous owner/repo shorthand (example.com/demo). */
const HOST = /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z](?:[a-z\d-]*[a-z\d])(?::\d+)?(?:[/?#]|$)/i;
const REPO_PATH = /^[\w.-]+\/[\w.-]+$/;
const isDotSegment = (part: string) => /^\.+$/.test(part);

/** Friendly input only; the server remains the authority for URL validation. */
export function normalizeProjectUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (HOST.test(value)) return `https://${value}`;
  // Never turn an unsupported scheme into a link that merely looks like HTTPS.
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;

  const shorthand = value.replace(/\/+$/, "");
  if (REPO_PATH.test(shorthand) && !shorthand.split("/").some(isDotSegment)) {
    return `https://github.com/${shorthand}`;
  }
  return value;
}

/** Require a real, explicit HTTP(S) URL, not the URL parser's relative-URL repairs. */
export function isHttpUrl(raw: string): boolean {
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value) || /[\\\r\n\t]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Repo identity only: subpaths, queries and the optional .git suffix are not its name. */
export function githubRepoOf(raw: string | null | undefined): { owner: string; repo: string } | null {
  if (!raw || !isHttpUrl(raw)) return null;
  try {
    const url = new URL(raw);
    if (!/^(?:www\.)?github\.com$/i.test(url.hostname) || url.username || url.password) return null;
    const match = /^\/([\w.-]+)\/([\w.-]+)(?:\/|$)/.exec(url.pathname);
    if (!match) return null;
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, "");
    if (!repo || isDotSegment(owner) || isDotSegment(repo)) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}
