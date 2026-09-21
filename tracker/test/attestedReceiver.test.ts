// Pure, synthetic checks for the explicitly opt-in metadata receiver.
// Nothing here touches the filesystem: every function under test is a projection,
// and the adapter is exercised only in its inert (no consented tools) form, which
// returns before it would open anything. No real HOME, log or account is involved.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AttestedMetadataAdapter, projectAttestedRecord } from "../src/adapters/attested";
import { attestedToolsFor, projectAttestedMetadata } from "../src/config";
import type { TrackerConfig } from "../src/types";

const NOW = Date.parse("2026-06-09T12:00:00.000Z");
const WINDOW = 5 * 60_000;
const TOOLS = ["quadcode"];
const record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, tool: "quadcode", recordId: "rec-1", occurredAt: "2026-06-09T11:59:00.000Z",
  model: "claude-fable-5-1", projectHint: "vibehub", measured: true,
  tokensInputDelta: 40, tokensOutputDelta: 10, ...overrides,
});
const project = (overrides?: Record<string, unknown>) =>
  projectAttestedRecord(record(overrides), NOW, WINDOW, TOOLS);
const config = (attested?: TrackerConfig["attestedMetadata"]): TrackerConfig => ({
  apiUrl: "https://fixture.invalid", deviceToken: "SYNTHETIC", projectAliases: {},
  ...(attested ? { attestedMetadata: attested } : {}),
});

describe("attested receiver: a record must be dated to count", () => {
  it("accepts an instant carrying Z", () => {
    assert.equal(project()?.lastActivityAt, Date.parse("2026-06-09T11:59:00.000Z"));
  });
  it("accepts an instant carrying a UTC offset", () => {
    assert.equal(project({ occurredAt: "2026-06-09T13:59:00.000+02:00" })?.lastActivityAt,
      Date.parse("2026-06-09T11:59:00.000Z"));
  });
  it("rejects the local-ISO-without-timezone shape Quadcode's own chat logs use", () => {
    // This is the whole reason native Quadcode stays off: such a string is not an
    // instant, and the receiver refuses to turn it into one by assuming a host offset.
    assert.equal(project({ occurredAt: "2026-06-09T11:59:00.000000" }), null);
    assert.equal(project({ occurredAt: "2026-06-09 11:59:00" }), null);
    assert.equal(project({ occurredAt: NOW - 60_000 }), null);
  });
  it("rejects stale and future instants rather than clamping them", () => {
    assert.equal(project({ occurredAt: "2026-06-09T11:50:00.000Z" }), null);
    assert.equal(project({ occurredAt: "2026-06-09T12:10:00.000Z" }), null);
  });
});

describe("attested receiver: usage is measured or unknown, never derived", () => {
  it("does NOT attribute counts for a tokenless tool, even when measured", () => {
    // Round 4: `quadcode` has no token counter in any source, so a producer's
    // measured claim cannot be honoured for it — the turn still counts as activity
    // and as a model sighting. Today `quadcode` is the only consentable receiver
    // tool, so the measured path below is implemented but unreachable until a tool
    // with a real counter joins ATTESTED_TOOLS.
    const observation = project();
    assert.equal(observation?.tool, "quadcode");
    assert.equal(observation?.tokensInputDelta, 0);
    assert.equal(observation?.tokensOutputDelta, 0);
    assert.deepEqual(observation?.usage, []);
  });
  it("reports activity with NO usage when the producer does not claim measurement", () => {
    const { tokensInputDelta, tokensOutputDelta, ...noCounts } = record();
    const observation = projectAttestedRecord({ ...noCounts, measured: false }, NOW, WINDOW, TOOLS);
    assert.equal(observation?.tool, "quadcode");
    assert.equal(observation?.model, "claude-fable-5-1");
    assert.deepEqual(observation?.usage, []);
  });
  it("refuses counts that arrive without a measured claim, so absence never reads as zero", () => {
    assert.equal(project({ measured: false }), null);
    assert.equal(project({ measured: undefined }), null);
  });
  it("refuses an estimated flag in any form", () => {
    assert.equal(project({ estimated: true }), null);
    assert.equal(project({ estimated: false }), null);
  });
  it("refuses counts that are not safe non-negative integers", () => {
    for (const bad of [1.5, -1, NaN, Infinity, "40", null]) {
      assert.equal(project({ tokensInputDelta: bad }), null);
      assert.equal(project({ tokensOutputDelta: bad }), null);
    }
  });
});

describe("attested receiver: identity is allowlisted, never invented", () => {
  it("keeps a reviewed model id and nulls everything else", () => {
    assert.equal(project()?.model, "claude-fable-5-1");
    assert.equal(project({ model: "gpt-5-codex" })?.model, "gpt-5-codex");
    // Observed under Quadcode but absent from the reviewed catalogs: stays unknown
    // rather than being added as a new id with no pricing evidence behind it.
    assert.equal(project({ model: "grok-4.6" })?.model, null);
    assert.equal(project({ model: "gemini-3.5-flash" })?.model, null);
    assert.equal(project({ model: 42 })?.model, null);
  });
  it("never carries a path and only carries a bounded project alias", () => {
    assert.equal(project()?.cwd, null);
    assert.equal(project({ projectHint: null })?.projectHint, null);
    assert.equal(project({ projectHint: "/Users/me/secret" }), null);
    assert.equal(project({ projectHint: "../escape" }), null);
  });
  it("refuses a tool the user did not consent to, and every native tool id", () => {
    assert.equal(projectAttestedRecord(record(), NOW, WINDOW, []), null);
    assert.equal(project({ tool: "claude-code" }), null);
    assert.equal(project({ tool: "codex" }), null);
    assert.equal(project({ tool: "cursor" }), null);
  });
  it("refuses an unversioned record or a malformed record id", () => {
    assert.equal(project({ v: 2 }), null);
    assert.equal(project({ v: undefined }), null);
    for (const bad of ["", "a".repeat(129), "has space", "../x", 7, null]) {
      assert.equal(project({ recordId: bad }), null);
    }
  });
  it("marks accepted records as activity, so presence-only evidence stays impossible", () => {
    assert.equal(project()?.confidence, "activity");
  });
});

describe("attested receiver: consent is explicit", () => {
  it("is absent by default and inert with no consented tools", async () => {
    assert.equal(projectAttestedMetadata(undefined), null);
    assert.deepEqual(attestedToolsFor(config()), []);
    assert.deepEqual(await new AttestedMetadataAdapter(WINDOW).poll(NOW), []);
    assert.deepEqual(await new AttestedMetadataAdapter(WINDOW, []).poll(NOW), []);
  });
  it("treats a switch that is off as no consent at all", () => {
    assert.deepEqual(attestedToolsFor(config({ enabled: false, tools: ["quadcode"] })), []);
    assert.deepEqual(attestedToolsFor(config({ enabled: true, tools: [] })), []);
    assert.deepEqual(attestedToolsFor(config({ enabled: true, tools: ["quadcode"] })), ["quadcode"]);
  });
  it("rejects malformed consent outright instead of silently downgrading it", () => {
    for (const bad of [null, "on", { tools: ["quadcode"] }, { enabled: "yes", tools: [] },
      { enabled: true, tools: "quadcode" }, { enabled: true, tools: ["claude-code"] },
      { enabled: true, tools: ["quadcode", "quadcode"] }, { enabled: true, tools: ["quadcode", "codex"] }]) {
      assert.equal(projectAttestedMetadata(bad), "invalid");
    }
  });
});
