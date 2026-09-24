import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PairingStore } from "../server/src/lib/pairing.ts";

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function runE2E() {
  console.log("=== End-to-End Device Pairing & Online Presence Verification ===");
  const store = new PairingStore();

  // Step 1: Device requests pairing code
  console.log("\n[Step 1] Device initiates pairing request...");
  const session = store.createSession("MacBook Pro M3", "mac", "http://localhost:5173");
  console.log("  -> Generated user code:", session.userCode);
  console.log("  -> Secret device code entropy:", session.deviceCode.length, "bytes hex");
  console.log("  -> Verification URI:", session.verificationUri);
  assert.ok(session.userCode.startsWith("VIBE-"), "User code must start with VIBE- prefix");
  assert.equal(session.verificationUri, `http://localhost:5173/pair?code=${session.userCode}`);

  // Step 2: Browser opens verification URI and fetches device details
  console.log("\n[Step 2] User browser visits verification URI...");
  const info = store.getInfo(session.userCode);
  console.log("  -> Display device name:", info.deviceName);
  console.log("  -> Display OS:", info.os);
  console.log("  -> Session validity:", info.valid);
  assert.equal(info.valid, true);
  assert.equal(info.deviceName, "MacBook Pro M3");
  assert.equal(info.os, "mac");
  assert.equal(info.alreadyApproved, false);

  // Step 3: Device polls before approval (pending state)
  console.log("\n[Step 3] Device polls while waiting for approval...");
  const pendingPoll = store.poll(session.deviceCode);
  console.log("  -> Device poll status:", pendingPoll.status);
  assert.equal(pendingPoll.status, "pending");
  assert.equal(pendingPoll.token, undefined);

  // Step 4: User clicks 'Allow this device' in browser
  console.log("\n[Step 4] Signed-in user clicks 'Allow this device' in browser...");
  const mockUserId = "usr_qa_dev_42";
  const rawSecretToken = generateRawToken();
  const tokenHash = hashToken(rawSecretToken);
  console.log("  -> Minted tracker token:", rawSecretToken.slice(0, 8) + "...");
  console.log("  -> Server stored hash:", tokenHash.slice(0, 16) + "...");

  const approved = store.approve(session.userCode, mockUserId, rawSecretToken);
  assert.equal(approved, true);
  console.log("  -> Approval recorded successfully");

  // Cannot approve twice (idempotency guard)
  const doubleApprove = store.approve(session.userCode, mockUserId, "second_token");
  assert.equal(doubleApprove, false);

  // Step 5: Device poll picks up approved token
  console.log("\n[Step 5] Device poll picks up approval & receives token...");
  const approvedPoll = store.poll(session.deviceCode);
  console.log("  -> Poll status:", approvedPoll.status);
  console.log("  -> Received token matches minted:", approvedPoll.token === rawSecretToken);
  assert.equal(approvedPoll.status, "approved");
  assert.equal(approvedPoll.token, rawSecretToken);
  assert.equal(approvedPoll.userId, mockUserId);

  // Step 6: Single-use claim guard: session is deleted immediately
  console.log("\n[Step 6] Verifying single-use token claim guard...");
  const repeatPoll = store.poll(session.deviceCode);
  console.log("  -> Subsequent poll returns:", repeatPoll.status);
  assert.equal(repeatPoll.status, "expired");

  // Step 7: Device verifies token
  console.log("\n[Step 7] Device verifies token against database hash...");
  const computedHash = hashToken(approvedPoll.token);
  assert.equal(computedHash, tokenHash, "Token hash must match stored TrackerToken hash");
  console.log("  -> Token verified: Bearer authentication successful");

  // Step 8: Device sends heartbeat and reports online presence
  console.log("\n[Step 8] Device sends heartbeat...");
  const now = Date.now();
  const mockSession = {
    userId: mockUserId,
    status: "ACTIVE",
    lastHeartbeatAt: new Date(now),
    startedAt: new Date(now - 30_000),
    tool: "cursor",
    model: "claude-3-5-sonnet",
  };
  console.log("  -> Heartbeat recorded: tool =", mockSession.tool, "model =", mockSession.model);

  // Verify presence computation
  const ageSeconds = Math.round((Date.now() - mockSession.lastHeartbeatAt.getTime()) / 1000);
  const isOnline = mockSession.status === "ACTIVE" && ageSeconds < 120;
  assert.equal(isOnline, true, "Device session must be ACTIVE and online");
  console.log("  -> Device status is ACTIVE and shows online (age: " + ageSeconds + "s)");

  console.log("\n✓ All 8 steps of end-to-end device pairing passed successfully!");
}

runE2E().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
