/*!
 * The claim this tool makes is falsifiable, so the tests falsify it.
 *
 * Two things have to hold for the product to be worth running. A page that is
 * genuinely fine in every state must produce no deltas — otherwise the tool is
 * a noise generator and gets switched off within a week. And a page that is
 * clean in the baseline but broken in one specific state must be caught, and
 * attributed to that state and no other. Everything else is detail.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { runMatrix, normalise, key } = require("../src/run.js");
const { STATES, selectStates } = require("../src/states.js");
const { aggregate } = require("../src/aggregate.js");
const { resolvePages, fromFile } = require("../src/pages.js");

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(name + (detail !== undefined ? "  -> " + detail : "")); }
}
const fixture = f => "file:///" + path.resolve(__dirname, "fixtures", f).replace(/\\/g, "/");
const OPTS = { tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], settle: 250, timeout: 30000 };

/* --------------------------------------------------------------- unit: keys */
console.log("\nKEYS — what counts as the same finding");
{
  const node = { target: [".btn"], failureSummary: "contrast of 4.1" };
  const other = { target: [".btn"], failureSummary: "contrast of 1.0" };
  ok("  same element+rule collapses across differing summaries",
     key("violation", "color-contrast", node) === key("violation", "color-contrast", other));
  ok("  a different element is a different finding",
     key("violation", "color-contrast", node) !== key("violation", "color-contrast", { target: [".x"] }));
  ok("  violation and incomplete are distinct",
     key("violation", "color-contrast", node) !== key("incomplete", "color-contrast", node));
}

console.log("\nNORMALISE — incomplete results are first-class");
{
  const m = normalise({
    violations: [{ id: "r1", help: "h", helpUrl: "u", nodes: [{ target: ["#a"], impact: "serious" }] }],
    incomplete: [{ id: "r2", help: "h", helpUrl: "u", nodes: [{ target: ["#b"] }] }]
  });
  ok("  collects both buckets", m.size === 2, m.size);
  ok("  labels the violation", [...m.values()].some(f => f.kind === "violation" && f.rule === "r1"));
  ok("  labels the incomplete", [...m.values()].some(f => f.kind === "incomplete" && f.rule === "r2"));
  ok("  incomplete without impact is marked review",
     [...m.values()].find(f => f.rule === "r2").impact === "review");
  ok("  a missing incomplete array does not throw",
     normalise({ violations: [], incomplete: undefined }).size === 0);
}

console.log("\nSTATE SELECTION");
{
  ok("  defaults to the full matrix", selectStates(null).length === STATES.length);
  ok("  always keeps the baseline", selectStates(["dark"]).some(s => s.id === "baseline"));
  ok("  keeps only what was asked for plus baseline", selectStates(["dark"]).length === 2);
  let threw = false;
  try { selectStates(["nope"]); } catch { threw = true; }
  ok("  rejects an unknown state", threw);
}

console.log("\nPAGE LISTS");
{
  const tmp = path.join(os.tmpdir(), "a11y-matrix-urls-test.txt");
  fs.writeFileSync(tmp, "# a comment\nhttps://a.example/\n\n  https://b.example/  \n# another\n");
  const got = fromFile(tmp);
  ok("  strips comments and blank lines", got.length === 2, got.join(","));
  ok("  trims whitespace", got[1] === "https://b.example/", JSON.stringify(got[1]));
  fs.unlinkSync(tmp);
}

console.log("\nAGGREGATION — one shared defect is one defect");
{
  const f = (rule, target, kind = "violation") => ({ kind, rule, target, impact: "serious", summary: "" });
  const page = (url, uniq) => ({
    url, ok: true,
    results: [
      { state: { id: "baseline" }, findings: new Map(), uniqueToState: [], suppressed: 0 },
      { state: { id: "dark" }, findings: new Map(), uniqueToState: uniq, suppressed: 0 }
    ]
  });
  const site = aggregate([
    page("/a", [f("color-contrast", ".nav-cta"), f("button-name", "#only-a")]),
    page("/b", [f("color-contrast", ".nav-cta")]),
    page("/c", [f("color-contrast", ".nav-cta")])
  ]);
  ok("  the shared defect is counted once", site.distinctMissed === 2, site.distinctMissed);
  const shared = site.findings.find(x => x.target === ".nav-cta");
  const onlyA = site.findings.find(x => x.target === "#only-a");
  ok("  and knows it is on every page", shared.scope === "every page", shared.scope);
  ok("  with the page count kept", shared.pageCount === 3, shared.pageCount);
  ok("  a single-page defect is not called site-wide", onlyA.scope === "one page", onlyA.scope);
  ok("  violations are counted separately", site.distinctViolations === 2, site.distinctViolations);
}
{
  /* Scope must not claim "every page" when there was only one page to be on. */
  const site = aggregate([{ url: "/only", ok: true, results: [
    { state: { id: "baseline" }, findings: new Map(), uniqueToState: [], suppressed: 0 },
    { state: { id: "dark" }, findings: new Map(), suppressed: 0,
      uniqueToState: [{ kind: "violation", rule: "color-contrast", target: ".x", impact: "serious", summary: "" }] }
  ] }]);
  ok("  one page scanned never yields \"every page\"",
     site.findings[0].scope === "one page", site.findings[0].scope);
}
{
  const site = aggregate([
    { url: "/ok", ok: true, results: [{ state: { id: "baseline" }, findings: new Map(), uniqueToState: [], suppressed: 0 }] },
    { url: "/bad", ok: false, error: "boom", results: [] }
  ]);
  ok("  failed pages are reported, not folded into the count",
     site.pagesScanned === 1 && site.pagesFailed.length === 1, site.pagesScanned + "/" + site.pagesFailed.length);
}

/* ------------------------------------------------------- integration: pages */
(async () => {
  console.log("\nPAGE CAP — truncation must never be silent");
  {
    let announced = null;
    const pages = await resolvePages(
      { urls: ["https://a.example/", "https://b.example/", "https://a.example/", "https://c.example/"],
        sitemap: null, urlsFile: null, maxPages: 2 },
      (found, cap) => { announced = { found, cap }; });
    ok("  duplicates removed before capping", pages.length === 2, pages.join(","));
    ok("  the cap is announced with the real total",
       announced && announced.found === 3 && announced.cap === 2, JSON.stringify(announced));
  }

  console.log("\nSITE SCAN — a shared defect is reported once, in place");
  {
    const site = aggregate(await Promise.all(
      ["shared-header-a.html", "shared-header-b.html"].map(async f => ({
        url: fixture(f), ok: true,
        results: await runMatrix(fixture(f), selectStates(["dark"]), OPTS)
      }))));
    const shared = site.findings.find(x => x.rule === "color-contrast" && x.target === "button");
    ok("  the header defect is found", !!shared,
       site.findings.map(f => f.rule + "@" + f.target).join(", "));
    ok("  and attributed to every page", shared && shared.scope === "every page", shared && shared.scope);
    ok("  not duplicated per page", site.distinctMissed === 1, site.distinctMissed);
    ok("  the page-specific baseline defect is not confused with it",
       site.baselineViolations >= 1, site.baselineViolations);
  }

  console.log("\nNO FALSE ALARMS — a page that is genuinely fine stays quiet");
  {
    const r = await runMatrix(fixture("clean.html"), STATES, OPTS);
    const noisy = r.filter(s => s.state.id !== "baseline" && s.uniqueToState.length);
    ok("  every state loaded", r.every(s => s.ok), r.filter(s => !s.ok).map(s => s.state.id).join(","));
    ok("  baseline is clean", r[0].findings.size === 0,
       [...r[0].findings.values()].map(f => f.rule + "@" + f.target).join(", "));
    ok("  no state reports anything new", noisy.length === 0,
       noisy.map(s => s.state.id + ":" + s.uniqueToState.map(f => f.rule).join("/")).join(" | "));
  }

  console.log("\nDARK-ONLY DEFECT — clean baseline, broken dark, attributed correctly");
  {
    const r = await runMatrix(fixture("dark-only.html"), STATES, OPTS);
    const by = id => r.find(s => s.state.id === id);
    ok("  baseline sees nothing at all", by("baseline").findings.size === 0,
       [...by("baseline").findings.values()].map(f => f.rule).join(","));
    ok("  dark mode reports a contrast finding",
       by("dark").uniqueToState.some(f => f.rule === "color-contrast"),
       by("dark").uniqueToState.map(f => f.rule).join(","));
    ok("  it is an incomplete, not a violation — the bucket pipelines discard",
       by("dark").uniqueToState.some(f => f.rule === "color-contrast" && f.kind === "incomplete"));
    ok("  and it names 1:1 against its own background",
       by("dark").uniqueToState.some(f => /1:1|1\.0/.test(f.summary)),
       by("dark").uniqueToState.map(f => f.summary).join(" | "));
    ok("  dark+mobile catches it too", by("dark-mobile").uniqueToState.length > 0);
    for (const id of ["reduced-motion", "forced-colors", "mobile", "reflow-320"])
      ok("  " + id + " is not blamed for it", by(id).uniqueToState.length === 0,
         by(id).uniqueToState.map(f => f.rule).join(","));
  }

  console.log("\nREFLOW-ONLY DEFECT — only the 320px state may report it");
  {
    const r = await runMatrix(fixture("reflow-only.html"), STATES, OPTS);
    const by = id => r.find(s => s.state.id === id);
    ok("  baseline is clean", by("baseline").findings.size === 0,
       [...by("baseline").findings.values()].map(f => f.rule + "@" + f.target).join(", "));
    ok("  reflow-320 reports something", by("reflow-320").uniqueToState.length > 0,
       "nothing found at 320px");
    ok("  desktop-width states stay quiet",
       ["dark", "reduced-motion", "forced-colors"].every(id => by(id).uniqueToState.length === 0));
  }

  console.log("\nREFLOW IS MEASURED, NOT INFERRED");
  {
    const r = await runMatrix(fixture("reflow-only.html"), selectStates(["reflow-320"]), OPTS);
    const at320 = r.find(s => s.state.id === "reflow-320");
    ok("  document overflow at 320px is reported as its own rule",
       at320.uniqueToState.some(f => f.rule === "page-horizontal-overflow"),
       at320.uniqueToState.map(f => f.rule).join(","));
    ok("  and it is a violation, not a judgement call",
       at320.uniqueToState.some(f => f.rule === "page-horizontal-overflow" && f.kind === "violation"));
    ok("  the baseline width does not trigger it",
       ![...r.find(s => s.state.id === "baseline").findings.values()]
         .some(f => f.rule === "page-horizontal-overflow"));
  }

  console.log("\nSCROLL CONTAINERS — fixing it correctly must not be punished");
  {
    const r = await runMatrix(fixture("scrollable-table.html"), STATES, OPTS);
    const noisy = r.filter(s => s.state.id !== "baseline" && s.uniqueToState.length);
    ok("  a labelled, focusable scroll region reports nothing new", noisy.length === 0,
       noisy.map(s => s.state.id + ":" + s.uniqueToState.map(f => f.rule).join("/")).join(" | "));
    ok("  the document itself never overflows",
       !r.some(s => [...s.findings.values()].some(f => f.rule === "page-horizontal-overflow")));
    ok("  and the suppression is disclosed rather than silent",
       r.some(s => s.suppressed > 0),
       "no state reported a suppressed count, so the reader cannot audit the decision");
  }

  console.log("\nFORCED COLORS — contrast findings are suppressed there on purpose");
  {
    const r = await runMatrix(fixture("dark-only.html"), selectStates(["forced-colors"]), OPTS);
    const fc = r.find(s => s.state.id === "forced-colors");
    ok("  no contrast finding is attributed to forced-colors",
       ![...fc.findings.values()].some(f => f.rule === "color-contrast"),
       "the OS palette is not the author's, so measuring it would be a lie");
  }

  console.log("\n" + (fail === 0
    ? `ALL ${pass} CHECKS PASSED`
    : `${pass} passed, ${fail} FAILED:\n  - ` + failures.join("\n  - ")));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
