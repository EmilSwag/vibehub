/**
 * Normalize pasted project links without coercing invalid input into a string.
 * Validation belongs to the project schemas; a blank string explicitly clears a URL.
 */
export function normalizeProjectUrl(raw: unknown): string | null | undefined {
  if (typeof raw !== "string") {
    // Preserve invalid runtime values for Zod's type error, rather than silently
    // turning them into an omitted field. The return type describes valid URLs only.
    return raw as string | null | undefined;
  }

  const value = raw.trim();
  if (!value) return null;
  const trimmedUrl = value.replace(/\/$/, "");

  if (/^https?:\/\//i.test(value)) return trimmedUrl;

  // Hostnames win over the ambiguous owner/repo shorthand (example.com/demo).
  // Check before schemes so a hostname with a numeric port also gets https://.
  if (/^(?:[\w-]+\.)+[\w-]+(?::\d+)?(?:[/?#]|$)/.test(value)) {
    return `https://${trimmedUrl}`;
  }

  // Never turn javascript:, ftp:, or any other explicit scheme into an https URL.
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;

  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmedUrl);
  if (shorthand && !/^\.+$/.test(shorthand[1]) && !/^\.+$/.test(shorthand[2])) {
    return `https://github.com/${trimmedUrl}`;
  }

  // Keep .git: parseGithubRepoUrl, not this normalizer, owns GitHub repo parsing.
  return trimmedUrl;
}
