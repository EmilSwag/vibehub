import assert from "node:assert/strict";
import { PairingStore } from "../pairing";

let passed = 0;
function eq<T>(label: string, actual: T, expected: T) {
  assert.deepEqual(actual, expected);
  passed++;
  console.log(`ok   ${label}`);
}

const store = new PairingStore();

// 1. Session creation
const session = store.createSession("My MacBook", "mac", "https://web.test");
assert.ok(session.deviceCode.length >= 32, "deviceCode is high entropy");
assert.ok(session.userCode.startsWith("VIBE-"), "userCode format");
eq("verificationUri matches userCode", session.verificationUri, `https://web.test/pair?code=${session.userCode}`);
eq("expires in 600s", session.expiresIn, 600);

// 2. Lookup by userCode
const lookup = store.getInfo(session.userCode);
eq("lookup valid", lookup.valid, true);
eq("lookup deviceName", lookup.deviceName, "My MacBook");
eq("lookup os", lookup.os, "mac");
eq("lookup not approved", lookup.alreadyApproved, false);

// Case insensitive lookup
const lowerLookup = store.getInfo(session.userCode.toLowerCase());
eq("case insensitive lookup valid", lowerLookup.valid, true);

// 3. Poll before approval
const pendingPoll = store.poll(session.deviceCode);
eq("poll before approve is pending", pendingPoll.status, "pending");

// 4. Approval
const approveResult = store.approve(session.userCode, "u_test_user", "raw_secret_token_123");
eq("approve succeeds", approveResult, true);

// Cannot approve twice
const approveAgain = store.approve(session.userCode, "u_other_user", "raw_second_token");
eq("cannot approve already approved session", approveAgain, false);

// 5. Poll after approval
const approvedPoll = store.poll(session.deviceCode);
eq("poll returns approved", approvedPoll.status, "approved");
eq("poll returns token", approvedPoll.token, "raw_secret_token_123");
eq("poll returns userId", approvedPoll.userId, "u_test_user");

// 6. Single-use token claim (token destroyed immediately upon claim)
const secondPoll = store.poll(session.deviceCode);
eq("second poll returns expired (session removed after claim)", secondPoll.status, "expired");

// 7. Expired session behavior
const shortTtlStore = new PairingStore();
const expiredSession = shortTtlStore.createSession("PC", "windows", "https://web.test");
// Artificially expire the session
const sessionObj = (shortTtlStore as unknown as { byUserCode: Map<string, { expiresAt: number }> }).byUserCode.get(expiredSession.userCode);
if (sessionObj) sessionObj.expiresAt = Date.now() - 1000;

eq("lookup of expired session is not valid", shortTtlStore.getInfo(expiredSession.userCode).valid, false);
const expiredApprove = shortTtlStore.approve(expiredSession.userCode, "u1", "tok");
eq("cannot approve expired session", expiredApprove, false);
eq("poll of expired session returns expired", shortTtlStore.poll(expiredSession.deviceCode).status, "expired");

console.log(`\n${passed} passed, 0 failed`);
