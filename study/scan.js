/*
 * Measures one question across a sample of public sites:
 *
 *   How much does a single-state accessibility run miss?
 *
 * Every automated accessibility pipeline renders a page once, in the state the
 * headless browser happens to boot in. This scans the same page across the
 * preference states real users arrive with and records how many findings exist
 * ONLY outside that baseline.
 *
 * Scope and honesty constraints, because a study that overclaims is worse than
 * no study:
 *
 *  - Homepages only, unauthenticated. One request set per site, same as a
 *    person opening the page. No crawling, no load.
 *  - axe-core detects a minority of WCAG failures. Every number here is a lower
 *    bound on a subset. It is not an audit and no site is called "inaccessible".
 *  - Findings are counted, not judged. axe "incomplete" results are kept
 *    separate from violations throughout, because they mean different things.
 *  - Sites are identified in the raw data but the published finding is the
 *    aggregate. The point is that the gap is structural, not that any
 *    particular team did badly.
 */
const fs = require("fs");
const path = require("path");
const { runMatrix } = require("../src/run.js");
const { STATES } = require("../src/states.js");

const SITES = JSON.parse(fs.readFileSync(path.join(__dirname, "sites.json"), "utf8"));
const OUT = path.join(__dirname, "results.json");

const OPTS = {
  tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  settle: 1200,      // real sites load webfonts and hydrate; contrast moves until they do
  timeout: 45000
};

function tally(findings) {
  let v = 0, i = 0;
  for (const f of findings) (f.kind === "violation" ? v++ : i++);
  return { violations: v, incomplete: i };
}

(async () => {
  const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
  const seen = new Set(done.map(d => d.url));
  const todo = SITES.filter(s => !seen.has(s.url));

  console.log(`${done.length} already scanned, ${todo.length} to go\n`);

  for (const site of todo) {
    const started = process.hrtime.bigint();
    process.stdout.write(site.name.padEnd(22));
    try {
      const results = await runMatrix(site.url, STATES, OPTS);
      const baseline = results.find(r => r.state.id === "baseline");

      /* One defect can surface in several states at once -- anything driven by
         a narrow viewport shows up in mobile, reflow-320 AND dark-mobile. Adding
         the per-state counts would report the same element three times and
         inflate every total. So findings are keyed by (kind, rule, element) and
         deduplicated across states; the per-state keys are kept so a finding can
         still be attributed to the preference that exposed it. */
      const keyOf = f => f.kind + "|" + f.rule + "|" + f.target;
      const byState = {};
      const distinct = new Map();

      for (const r of results) {
        if (r.state.id === "baseline") continue;
        const keys = r.uniqueToState.map(keyOf);
        byState[r.state.id] = { ...tally(r.uniqueToState), ok: r.ok,
                                suppressed: r.suppressed || 0, keys };
        for (const f of r.uniqueToState) distinct.set(keyOf(f), f);
      }

      const all = [...distinct.values()];
      const rec = {
        url: site.url, name: site.name, category: site.category,
        ok: results.every(r => r.ok),
        baseline: tally(baseline.findings.values()),
        byState,
        distinctMissed: all.length,
        distinctViolations: all.filter(f => f.kind === "violation").length,
        rules: [...new Set(all.map(f => f.rule))]
      };
      done.push(rec);
      const secs = Number(process.hrtime.bigint() - started) / 1e9;
      console.log(`base ${String(rec.baseline.violations).padStart(3)}v/${String(rec.baseline.incomplete).padStart(3)}i` +
                  `   distinct-missed ${String(rec.distinctMissed).padStart(3)}` +
                  ` (${String(rec.distinctViolations).padStart(2)}v)` +
                  `   ${secs.toFixed(0)}s`);
    } catch (e) {
      done.push({ url: site.url, name: site.name, category: site.category, ok: false, error: e.message });
      console.log("FAILED  " + e.message.slice(0, 70));
    }
    /* Written after every site so a crash 40 sites in does not cost the run. */
    fs.writeFileSync(OUT, JSON.stringify(done, null, 2));
  }

  console.log(`\nwrote ${OUT}`);
})();
