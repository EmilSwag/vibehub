// Honest achievements (meta/plans/vibehub-honest-achievements-feed.md, A4): the tracker
// tells the server which wall clock the person saw, so a local-time badge (Night Owl,
// 03:00-06:00) reads a real zone instead of guessing one from UTC.
//
// What this pins: the field is a validated pass-through in the outgoing projection - a
// sane integer offset survives, anything else is dropped rather than coerced - and it
// rides on session_start (the event that opens the server-side Session) and heartbeat,
// never on session_end. Pure: `src/privacy.ts` imports nothing but types.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isTzOffsetMinutes, localTzOffsetMinutes, MAX_TZ_OFFSET_MINUTES, projectHeartbeat } from "../src/privacy";

const NOW = Date.parse("2026-06-09T12:00:00.000Z");
const ISO = "2026-06-09T11:59:30.000Z";
const beat = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventType: "heartbeat", projectAlias: "Demo", tool: "claude-code", model: "claude-opus-5",
  occurredAt: ISO, usage: [], ...overrides,
});

describe("tzOffsetMinutes: the host zone rides along, validated, never inferred", () => {
  it("passes a sane integer offset through on heartbeat and session_start", () => {
    for (const eventType of ["heartbeat", "session_start"]) {
      for (const tzOffsetMinutes of [180, -420, 0, 345, MAX_TZ_OFFSET_MINUTES, -MAX_TZ_OFFSET_MINUTES]) {
        const projected = projectHeartbeat(beat({ eventType, tzOffsetMinutes }), NOW);
        assert.equal(projected?.tzOffsetMinutes, tzOffsetMinutes, `${eventType} must carry ${tzOffsetMinutes}`);
      }
    }
  });

  it("drops anything that is not a whole number of minutes within +-14 h, and still sends the beat", () => {
    for (const tzOffsetMinutes of [MAX_TZ_OFFSET_MINUTES + 1, -(MAX_TZ_OFFSET_MINUTES + 1), 1.5, "180", null,
      Number.NaN, Number.POSITIVE_INFINITY, {}, [180], true]) {
      const projected = projectHeartbeat(beat({ tzOffsetMinutes }), NOW);
      assert.ok(projected, `a bad zone must not cost the heartbeat (${String(tzOffsetMinutes)})`);
      assert.equal(Object.hasOwn(projected, "tzOffsetMinutes"), false, `${String(tzOffsetMinutes)} must be dropped`);
      assert.equal(isTzOffsetMinutes(tzOffsetMinutes), false);
    }
  });

  it("is absent when the caller sent none - the server never sees a fabricated zero", () => {
    const projected = projectHeartbeat(beat(), NOW);
    assert.ok(projected);
    assert.equal(Object.hasOwn(projected, "tzOffsetMinutes"), false);
  });

  it("never rides on session_end, which writes no Session row", () => {
    const projected = projectHeartbeat(beat({ eventType: "session_end", tzOffsetMinutes: 180 }), NOW);
    assert.ok(projected);
    assert.equal(projected.eventType, "session_end");
    assert.equal(Object.hasOwn(projected, "tzOffsetMinutes"), false);
  });

  it("localTzOffsetMinutes is the sign-flipped getTimezoneOffset and always a sane offset", () => {
    const now = new Date();
    const offset = localTzOffsetMinutes(now);
    assert.equal(offset, -now.getTimezoneOffset());
    assert.ok(isTzOffsetMinutes(offset), `${String(offset)} must be a zone`);
    // Round-trips the projection unchanged, so what the daemon reads is what the server stores.
    assert.equal(projectHeartbeat(beat({ tzOffsetMinutes: offset }), NOW)?.tzOffsetMinutes, offset);
  });
});
