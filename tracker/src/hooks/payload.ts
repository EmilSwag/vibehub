import { randomUUID } from "node:crypto";
import { ATTESTED_RECORD_VERSION } from "../adapters/attested";
import { eventTime, folderFromCwd, MAX_EVENT_AGE_MS, objectRecord, safeModel } from "../privacy";

/**
 * The PRODUCER side of `attested-metadata-v1` — one code path, every hookable vendor.
 *
 * This module never runs inside the daemon. It runs in the short-lived process an IDE
 * spawns for one hook event (`vibehub-tracker hook cursor`), turns that event into the
 * smallest possible record, and hands it to `inbox.ts` to append. The daemon's receiver
 * (`adapters/attested.ts`) then validates the record again from scratch: nothing here is
 * trusted downstream, and nothing here reads a vendor's files, processes or windows.
 *
 * What a vendor hands us on stdin is far more than we want. Cursor's base payload carries
 * `prompt`, `conversation_id`, `generation_id`, `workspace_roots`, `user_email` and
 * `transcript_path`; Windsurf's `post_cascade_response` carries the entire response inside
 * `tool_info`. Exactly three things are read — which event fired, the model id, and (as a
 * folder basename only) the workspace path — and the record is built from scratch around
 * them. `tool` comes from argv, not from the payload, so a vendor cannot even name itself.
 *
 * The record carries NO `measured` flag, NO token counts and NO `estimated`, in any
 * polarity. Neither vendor reports a token count, and absence is the strongest possible
 * statement of that: there is no field for a future change to flip, and the receiver reads
 * the absent counts as unknown rather than as a measured zero.
 */

/** Tools with an official, documented, user-installed hook system. */
export const HOOKABLE_TOOLS = ["cursor", "windsurf"] as const;
export type HookableTool = (typeof HOOKABLE_TOOLS)[number];

export function isHookableTool(tool: unknown): tool is HookableTool {
  return tool === "cursor" || tool === "windsurf";
}

interface VendorHooks {
  /** Payload field naming the event that fired. */
  readonly eventField: string;
  /** ONLY these events are subscribed to, and only these are accepted on the way in. */
  readonly events: readonly string[];
  /** Payload fields that may carry the model id, in preference order. */
  readonly modelFields: readonly string[];
  /** Payload fields that may carry a workspace path. Only its basename is ever used. */
  readonly projectFields: readonly string[];
  /**
   * Payload field carrying the vendor's own event time, or null when the vendor
   * publishes none. A stamp is used ONLY when it is a real instant inside the active
   * window; anything else falls back to this process's clock, never to a repair.
   */
  readonly timestampField: string | null;
}

/**
 * Vendor differences are these two rows. Event names, field names and the hook file
 * format were read from the vendors' own documentation (see ../../../docs/ARCHITECTURE.md
 * §4.7 for the citations); nothing here is inferred from an installed copy.
 *
 * Deliberately absent from both lists: Windsurf's
 * `post_cascade_response_with_transcript`, which writes the whole conversation to disk,
 * Cursor's `beforeSubmitPrompt`, whose payload IS the prompt the user just typed, and
 * every `pre_*`/`post_*` file, command and MCP event in both products.
 */
const VENDORS: Readonly<Record<HookableTool, VendorHooks>> = {
  cursor: {
    eventField: "hook_event_name",
    // Turn completions only. `sessionStart`/`sessionEnd` were subscribed for one round and
    // are now RETIRED: a session boundary is not a turn, and `sessionEnd` in particular can
    // fire hours after the last model call, which would report activity at a moment when
    // no AI work happened. They are not in this list, so a payload claiming one is refused
    // on arrival like any other unsubscribed event (see RETIRED_EVENTS in ./install).
    events: ["afterAgentResponse", "stop"],
    // `model` is the documented base field; `model_id` is accepted because the Round 3
    // matrix recorded it, and a vendor that renames the field must not silently drop the
    // model — it would be reported as unknown rather than wrong, but unknown-by-typo is
    // still avoidable.
    modelFields: ["model_id", "model"],
    projectFields: ["workspace_roots", "workspace_root", "cwd"],
    // Cursor documents no timestamp on any hook payload, so there is nothing to read.
    timestampField: null,
  },
  windsurf: {
    eventField: "agent_action_name",
    events: ["pre_user_prompt", "post_cascade_response"],
    modelFields: ["model_name"],
    projectFields: ["cwd", "workspace_root"],
    timestampField: "timestamp",
  },
};

/** The subscribed events, in registration order — what `hooks install` writes. */
export function hookEventsFor(tool: HookableTool): string[] {
  return [...VENDORS[tool].events];
}

/**
 * One line of `~/.vibehub/attested.jsonl`. Exactly these keys are ever written.
 * `projectHint` is present only when the payload carried a workspace path whose last
 * segment survives the alias rules; `measured`, `tokensInputDelta`, `tokensOutputDelta`
 * and `estimated` are absent by construction and have no code path that could add them.
 */
export interface AttestedHookRecord {
  v: number;
  tool: HookableTool;
  recordId: string;
  occurredAt: string;
  model: string | null;
  projectHint?: string;
}

/**
 * Projects one vendor hook payload into a record, or `null` when the event is not one we
 * subscribe to. Every branch fails closed; nothing is coerced, repaired or inferred.
 *
 * `tool` is the argv argument the user's own hook command carries, never a payload field.
 */
export function projectHookEvent(
  tool: unknown, payload: unknown, now: number
): AttestedHookRecord | null {
  if (!isHookableTool(tool) || !Number.isFinite(now)) return null;
  const p = objectRecord(payload);
  if (!p) return null;
  const vendor = VENDORS[tool];
  const event = p[vendor.eventField];
  if (typeof event !== "string" || !vendor.events.includes(event)) return null;

  // Dating. Cursor publishes nothing, so the record is stamped at the instant the hook
  // fired — a hook process is spawned synchronously at the event, so its own clock is a
  // genuine observation. Windsurf publishes an ISO 8601 stamp with no documented zone
  // guarantee: it is used only when `eventTime` accepts it as a real, fresh instant, and
  // a zoneless, stale or future stamp falls back to now rather than being repaired by
  // assuming the host offset. The receiver applies the identical rule to whatever this
  // writes, and rejects — never repairs — anything that fails it.
  const stamped = vendor.timestampField === null
    ? null : eventTime(p[vendor.timestampField], now, MAX_EVENT_AGE_MS);
  const at = new Date(stamped ?? now);
  if (!Number.isFinite(at.getTime())) return null;

  // The model runs through the SAME allowlist the receiver will apply, here as well as
  // there, and NOTHING is added to that allowlist on a hook tool's behalf. An unreviewed
  // vendor display id becomes null before it is ever written, so the inbox holds no
  // model string this project has not already reviewed.
  let model: string | null = null;
  for (const field of vendor.modelFields) {
    model = safeModel(p[field], tool);
    if (model !== null) break;
  }

  // Project identity is the LAST PATH SEGMENT and nothing else, extracted from a string
  // by `folderFromCwd` exactly as the Claude Code and Codex adapters do with their logs'
  // own `cwd`: no directory is opened, stat-ed or walked, the full path never leaves this
  // function, and the basename still passes through the user's alias/hidden override
  // downstream. A path that is relative, has traversal segments or does not survive
  // `safeAlias` yields nothing, and the record simply carries no hint.
  const projectHint = projectHintFrom(p, vendor.projectFields);

  const record: AttestedHookRecord = {
    v: ATTESTED_RECORD_VERSION,
    tool,
    // Fresh and random per event: no vendor identifier — not even a digest of one —
    // reaches the file. The cost is that a vendor retrying the identical hook
    // invocation is two records rather than one; these tools carry no token counts, so
    // that costs a duplicate activity sighting and nothing measurable.
    recordId: randomUUID(),
    occurredAt: at.toISOString(),
    model,
  };
  if (projectHint !== null) record.projectHint = projectHint;
  return record;
}

function projectHintFrom(p: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = p[field];
    const candidate = Array.isArray(value) ? value.find((entry) => typeof entry === "string") : value;
    const alias = folderFromCwd(candidate);
    if (alias !== null) return alias;
  }
  return null;
}
