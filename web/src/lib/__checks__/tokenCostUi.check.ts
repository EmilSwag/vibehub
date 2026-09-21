// Source-level UI wiring checks, NOT browser/pixel/assistive-technology validation.
// Read only these reviewed UI/helper/style files. Never import ProfilePage, API,
// auth, tracker or account modules at runtime. No browser, network or file writes.
import ts from "typescript";

// This runner is Node-only; the web's DOM-only typecheck needs no new Node typings.
const fsModule = "node:fs";
const { readFileSync } = await import(fsModule) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const parse = (path: string) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const stats = parse("../../components/StatsPanel.tsx");
const recent = parse("../../components/RecentModels.tsx");
const level = parse("../../components/ui/LevelBadge.tsx");
const tile = parse("../../components/ui/StatTile.tsx");
const cost = parse("../../components/ui/TokenCost.tsx");
const profile = parse("../../pages/ProfilePage.tsx");
const grouping = parse("../recentModels.ts");
const costCss = read("../../components/ui/TokenCost.module.css");
const recentCss = read("../../components/RecentModels.module.css");
const tileCss = read("../../components/ui/StatTile.module.css");
const levelCss = read("../../components/ui/LevelBadge.module.css");

let passed = 0;
const failures: string[] = [];
function ok(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`ok   ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}`); }
}
function collect<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const result: T[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return result;
}
type Tag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
const tags = (root: ts.Node, name?: string) => collect(root, (n): n is Tag =>
  (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && (!name || n.tagName.getText() === name));
const calls = (root: ts.Node, name: string) => collect(root, ts.isCallExpression).filter((n) => n.expression.getText() === name);
function attr(node: Tag, name: string): string | undefined {
  const property = node.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name);
  const value = property?.initializer;
  return value && ts.isJsxExpression(value) ? value.expression?.getText() : value && ts.isStringLiteral(value) ? value.text : undefined;
}
function ancestors(node: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  for (let p = node.parent; p; p = p.parent) result.push(p);
  return result;
}
function fn(root: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const node = root.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw new Error(`Missing reviewed UI function: ${name}`);
  return node;
}
const insideButton = (node: ts.Node) => ancestors(node).some((p) => ts.isJsxElement(p) && p.openingElement.tagName.getText() === "button");
const cssBlock = (css: string, name: string) => css.match(new RegExp(`\\.${name}\\s*\\{([^}]+)\\}`))?.[1] ?? "";

ok("Profile still renders StatsPanel", tags(profile, "StatsPanel").length === 1);
ok("Profile still renders RecentModels", tags(profile, "RecentModels").length === 1);
ok("Profile still renders LevelBadge", tags(profile, "LevelBadge").length === 1);
ok("no unaccompanied inline ProfilePage token counter", calls(profile, "formatTokens").length === 0);

const statsCalls = calls(stats, "estimateTokenCost");
ok("Stats estimate uses the SAME response's model rows and total", statsCalls.length === 1 && statsCalls[0].arguments.map((a) => a.getText()).join("|") === "stats?.byModel|stats?.totalTokens");
const tokenTile = tags(stats, "StatTile").find((t) => attr(t, "label") === "Tokens · fuel");
ok("token count is retained in the quiet tile", !!tokenTile && tokenTile.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === "quiet") && !!attr(tokenTile, "value")?.includes("formatTokens(stats.totalTokens)"));
ok("Stats token value is guarded against invalid counts", !!tokenTile && !!attr(tokenTile, "value")?.includes("isValidTokenCount(stats.totalTokens)"));
ok("Stats cost is a companion, never a replacement count", !!tokenTile && tags(tokenTile, "TokenCost").length === 1 && attr(tokenTile, "companion")?.includes("<TokenCost estimate={cost}") === true);
ok("stat companion preserves its own loading placeholder", fn(tile, "StatTile").getText().includes("companion && <span className={styles.companion}><Skeleton"));
ok("stat companion uses a wrapping value container", fn(tile, "StatTile").getText().includes("!!companion && styles.withCompanion"));

const modelCalls = calls(recent, "groupStatsByModelWithCosts");
ok("model costs use lifetime rows, not fortnight/presence", modelCalls.length === 1 && modelCalls[0].arguments[0].getText() === "lifetime.byModel");
const recentCosts = tags(fn(recent, "Row"), "TokenCost");
ok("both model and tool rows always render a cost", recentCosts.length === 2 && recentCosts.some((t) => attr(t, "estimate") === "row.cost") && recentCosts.some((t) => attr(t, "estimate") === "bucket.cost"));
for (const node of recentCosts) {
  const name = attr(node, "estimate")!;
  const pair = ancestors(node).find((p): p is ts.JsxElement => ts.isJsxElement(p) && attr(p.openingElement, "className")?.includes("styles.tokenPair") === true);
  ok(`${name}: cost stays beside its count`, !!pair && calls(pair, "tokenCount").length === 1);
  ok(`${name}: never inside a row/chip button`, !insideButton(node));
  ok(`${name}: not conditional on live/open/compact/positive/known state`, !ancestors(node).some((p) => ts.isConditionalExpression(p) || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)));
}
const rowButton = tags(fn(recent, "Row"), "button").find((t) => attr(t, "className") === "styles.rowHit");
const modelCost = recentCosts.find((t) => attr(t, "estimate") === "row.cost");
ok("row keyboard focus announces the cost description", !!rowButton && !!modelCost && attr(rowButton, "aria-describedby") === attr(modelCost, "id"));
ok("existing collapsed tool details remain hidden from AT", tags(recent, "div").some((t) => attr(t, "aria-hidden") === "aria.detailHidden || undefined"));
ok("invalid recent token labels are guarded", recent.text.includes("isValidTokenCount(tokens) ?"));
ok("each model/tool numeric count has a dedicated nowrap span", tags(fn(recent, "Row"), "span").filter((t) => attr(t, "className") === "styles.tokenNumber").length === 2);
ok("model skeleton has a distinct cost footprint", fn(recent, "RecentModelsSkeleton").getText().includes("styles.tokenPair"));
const groupedCostCalls = calls(fn(grouping, "groupStatsByModelWithCosts"), "estimateTokenCost");
const groupedTokenlessCalls = calls(fn(grouping, "groupStatsByModelWithCosts"), "tokenlessCost");
ok("folded group uses original records, not representative model", groupedCostCalls.length === 2 && groupedCostCalls[0].arguments.map((a) => a.getText()).join("|") === "measured|group.tokens");
// "measured" is those original records minus the tools that report no counts. The
// expanded row prints the per-tool prices under the row price, so pricing a bucket
// the row then suppresses would leave the detail not adding up to its own total.
ok("the row prices exactly the buckets it will show a price for",
  fn(grouping, "groupStatsByModelWithCosts").getText().includes("group.byTool.filter((bucket) => !bucket.tokenless).flatMap((bucket) => tools.get(bucket.tool) ?? [])"));
ok("the row still declares its whole token figure, so the unmeasured part reads as uncovered",
  groupedCostCalls[0].arguments[1].getText() === "group.tokens");
ok("a tokenless row and a tokenless bucket are unpriced, never a zero",
  groupedTokenlessCalls.length === 2 && groupedTokenlessCalls.map((c) => c.arguments[0].getText()).join("|") === "group.tokens|bucket.tokens");
ok("folded tool uses its own original records and count", groupedCostCalls.length === 2 && groupedCostCalls[1].arguments.map((a) => a.getText()).join("|") === "tools.get(bucket.tool)|bucket.tokens");

const levelCalls = calls(level, "estimateTokenCost");
ok("LevelBadge never fabricates a cost from a bare lifetime total", levelCalls.length === 1 && levelCalls[0].arguments.map((a) => a.getText()).join("|") === "undefined|breakdown?.totalTokens");
ok("level token display retains its count and cost", tags(level, "TokenCost").length === 1 && level.text.includes("formatTokens(breakdown.totalTokens)") && level.text.includes("label === \"Tokens\""));
ok("invalid lifetime counter is guarded", level.text.includes("isValidTokenCount(breakdown.totalTokens)"));

const inlineCost = fn(cost, "TokenCost");
ok("inline cost contains text spans only, safe inside buttons/hidden rows", tags(inlineCost).every((t) => t.tagName.getText() === "span"));
ok("inline cost adds no tab stops or click handlers", tags(inlineCost).every((t) => !t.attributes.properties.some((a) => ts.isJsxAttribute(a) && /^(tabIndex|onClick|onKeyDown|role)$/.test(a.name.getText()))));
ok("cost uses shared safe presentation, not direct numeric formatting", calls(inlineCost, "presentTokenCost").length === 1 && !inlineCost.getText().includes(".toFixed"));
ok("coverage is visible text", inlineCost.getText().includes("{text.coverage}"));
ok("accessible description is not title-only", tags(inlineCost, "span").some((t) => attr(t, "className") === "styles.srOnly" && attr(t, "id") === "id"));
const disclosure = fn(cost, "TokenCostDetails");
ok("billing disclosure is a native keyboard/touch details element", tags(disclosure, "details").length === 1 && tags(disclosure, "summary").length === 1 && disclosure.getText().includes("API estimate"));
ok("disclosure includes limitations and source date", disclosure.getText().includes("TOKEN_COST_LIMITATIONS") && tags(disclosure, "time").some((t) => attr(t, "dateTime") === "TOKEN_PRICING_CHECKED_AT"));
ok("official sources are linked safely", tags(disclosure, "a").length === 2 && tags(disclosure, "a").every((t) => attr(t, "href")?.startsWith("TOKEN_PRICING_SOURCES.") && attr(t, "rel") === "noreferrer"));
for (const [name, file] of [["StatsPanel", stats], ["RecentModels", recent], ["LevelBadge", level]] as const) {
  const notes = tags(file, "TokenCostDetails");
  ok(`${name}: one accessible billing disclosure`, notes.length === 1);
  ok(`${name}: disclosure is never nested inside a button`, notes.every((n) => !insideButton(n)));
}

ok("currency numbers are nowrap", /white-space:\s*nowrap/.test(cssBlock(costCss, "amount")));
ok("cost container can wrap", /flex-wrap:\s*wrap/.test(cssBlock(costCss, "cost")));
ok("cost uses readable monochrome secondary ink", /color:\s*var\(--vh-text-dim\)/.test(cssBlock(costCss, "cost")));
ok("partial coverage can wrap", /white-space:\s*normal/.test(cssBlock(costCss, "coverage")));
ok("screen-reader description uses visual clipping, not display none", /clip-path:\s*inset\(50%\)/.test(cssBlock(costCss, "srOnly")) && !/display:\s*none/.test(cssBlock(costCss, "srOnly")));
ok("details has a visible keyboard focus style", costCss.includes("summary:focus-visible") && costCss.includes("--vh-focus-ring"));
ok("coarse pointers get a 44px disclosure target", /@media\s*\(pointer:\s*coarse\)[\s\S]*min-height:\s*44px/.test(costCss));
ok("cost adds no hue or animation", !/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(|--vh-live|animation:|transition:/i.test(costCss));
ok("model/tool token pair can wrap", /flex-wrap:\s*wrap/.test(cssBlock(recentCss, "tokenPair")));
ok("model/tool token number stays nowrap", /white-space:\s*nowrap/.test(cssBlock(recentCss, "tokenNumber")));
ok("summary value with cost can wrap", /flex-wrap:\s*wrap/.test(cssBlock(tileCss, "withCompanion")));
ok("summary cost remains secondary-sized", /font-size:\s*12px/.test(cssBlock(tileCss, "companion")));
ok("level token/cost pair can wrap", /flex-wrap:\s*wrap/.test(cssBlock(levelCss, "tokenValue")));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`tokenCost UI wiring checks failed: ${failures.join(", ")}`);
