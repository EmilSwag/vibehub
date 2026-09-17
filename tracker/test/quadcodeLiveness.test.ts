// Privacy supersedes the old body-length/file-edit liveness heuristics.
// These compatibility exports are pure: no host data, fixture HOME, or live AI log is needed.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { QuadcodeAdapter, estimateTokens, stripToolResults } from "../src/adapters/quadcode";
import { ProcessAdapter, isRealWindowTitle, projectFromTitle } from "../src/adapters/processes";

const BODY = "synthetic prompt / code / tool output, never evidence";
describe("unsupported AI sources fail closed", () => {
  it("Quadcode is unavailable instead of estimated from chat bodies or filesystem changes", async () => {
    assert.deepEqual(await new QuadcodeAdapter(300000).poll(), []);
  });
  it("generic process/editor presence is not a supported source", async () => {
    assert.deepEqual(await new ProcessAdapter(300000).poll(), []);
  });
  it("conversation length cannot produce invented token counts", () => {
    assert.equal(estimateTokens(BODY), 0);
  });
  it("retired content helpers do not retain or return raw prompt/tool output", () => {
    assert.equal(stripToolResults(BODY), "");
  });
  it("window titles cannot produce activity or a project alias", () => {
    assert.equal(isRealWindowTitle("Private project - Cursor"), false);
    assert.equal(projectFromTitle("Private project - Cursor", ["Cursor"]), null);
  });
});
