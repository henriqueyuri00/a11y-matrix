/*
 * Turns results.json into the numbers the write-up is allowed to claim.
 *
 * Every figure here is deliberately conservative:
 *  - findings are deduplicated across states before being counted, because one
 *    narrow-viewport defect surfaces in three of them and summing per-state
 *    counts would report it three times;
 *  - sites that failed to load are counted separately, never folded into a
 *    denominator;
 *  - violations and axe "incomplete" results are never added into a single
 *    headline, because they mean different things;
 *  - the headline is "findings a baseline run did not surface", not "failures":
 *    axe reporting something is not the same as a WCAG failure.
 */
const fs = require("fs");
const path = require("path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "results.json"), "utf8"));

/* Join the noise-floor control, if it has been run. A site whose output differs
   between two IDENTICAL runs cannot support a claim that a difference between
   two DIFFERENT runs was caused by the preference. Those sites are named, and
   excluded from the conservative headline rather than quietly kept. */
const controlPath = path.join(__dirname, "control.json");
const control = fs.existsSync(controlPath)
  ? new Map(JSON.parse(fs.readFileSync(controlPath, "utf8")).map(c => [c.url, c]))
  : new Map();

for (const d of data) {
  const c = control.get(d.url);
  d.noise = c && c.ok ? c.appeared + c.disappeared : null;
  d.stable = d.noise === 0;
}

const ok = data.filter(d => d.ok);
const failed = data.filter(d => !d.ok);
const stable = ok.filter(d => d.stable);

const pct = (n, d) => d === 0 ? "—" : (100 * n / d).toFixed(0) + "%";
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const median = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

console.log(`\nSAMPLE`);
console.log(`  ${data.length} sites attempted, ${ok.length} scanned, ${failed.length} failed to load`);
if (failed.length) console.log(`  failed: ${failed.map(f => f.name).join(", ")}`);

const missed = ok.filter(d => d.distinctMissed > 0);
const missedV = ok.filter(d => d.distinctViolations > 0);

console.log(`\nHEADLINE  (all sites that scanned)`);
console.log(`  ${missed.length}/${ok.length} (${pct(missed.length, ok.length)}) had at least one finding a baseline-only run did not surface`);
console.log(`  ${missedV.length}/${ok.length} (${pct(missedV.length, ok.length)}) had at least one such finding axe classes as a VIOLATION`);

console.log(`\nVOLUME  (deduplicated across states)`);
console.log(`  baseline violations across the sample  : ${sum(ok, d => d.baseline.violations)}`);
console.log(`  baseline incomplete                    : ${sum(ok, d => d.baseline.incomplete)}`);
console.log(`  distinct findings missed by baseline   : ${sum(ok, d => d.distinctMissed)}`);
console.log(`    of which violations                  : ${sum(ok, d => d.distinctViolations)}`);
console.log(`  median missed per site                 : ${median(ok.map(d => d.distinctMissed))}`);
console.log(`  worst single site                      : ${Math.max(0, ...ok.map(d => d.distinctMissed))}`);

console.log(`\nWHAT EXPOSED IT`);
/* A finding is attributed to a group of states, not to one, because narrow
   viewports overlap by construction. Reporting "which single state found it"
   would be arbitrary between three equally valid answers. */
const GROUPS = {
  "narrow viewport": ["mobile", "reflow-320", "dark-mobile"],
  "dark scheme":     ["dark", "dark-mobile"],
  "reduced motion":  ["reduced-motion"],
  "forced colors":   ["forced-colors"]
};
for (const [label, ids] of Object.entries(GROUPS)) {
  let sites = 0, findings = 0;
  for (const d of ok) {
    const keys = new Set(ids.flatMap(id => d.byState[id]?.keys || []));
    if (keys.size) { sites++; findings += keys.size; }
  }
  console.log(`  ${label.padEnd(18)} ${String(sites).padStart(3)} sites   ${String(findings).padStart(4)} distinct findings`);
}
/* Dark-only: exposed by a dark state and by nothing narrow, so the colour
   scheme is the only variable that can explain it. */
let darkOnlySites = 0, darkOnly = 0;
for (const d of ok) {
  const narrow = new Set(["mobile", "reflow-320"].flatMap(id => d.byState[id]?.keys || []));
  const dark = new Set(["dark", "dark-mobile"].flatMap(id => d.byState[id]?.keys || []));
  const only = [...dark].filter(k => !narrow.has(k));
  if (only.length) { darkOnlySites++; darkOnly += only.length; }
}
console.log(`  ${"dark scheme ALONE".padEnd(18)} ${String(darkOnlySites).padStart(3)} sites   ${String(darkOnly).padStart(4)} distinct findings`);

console.log(`\nRULES INVOLVED  (sites where the rule fired outside the baseline)`);
const ruleCount = {};
for (const d of ok) for (const r of d.rules || []) ruleCount[r] = (ruleCount[r] || 0) + 1;
Object.entries(ruleCount).sort((a, b) => b[1] - a[1])
  .forEach(([r, c]) => console.log(`  ${String(c).padStart(3)} sites  ${r}`));

console.log(`\nBY CATEGORY`);
for (const c of [...new Set(ok.map(d => d.category))]) {
  const g = ok.filter(d => d.category === c);
  const m = g.filter(d => d.distinctMissed > 0).length;
  console.log(`  ${c.padEnd(14)} ${m}/${g.length} affected (${pct(m, g.length)}), ` +
              `${sum(g, d => d.distinctMissed)} distinct findings missed`);
}

if (control.size) {
  const unstable = ok.filter(d => d.noise !== null && d.noise > 0);
  const unknown = ok.filter(d => d.noise === null);
  console.log(`\nNOISE CONTROL  (same state twice, nothing changed between runs)`);
  console.log(`  ${stable.length}/${ok.length} sites produced identical output across two identical runs`);
  if (unstable.length) console.log(`  unstable: ${unstable.map(d => `${d.name}(${d.noise})`).join(", ")}`);
  if (unknown.length)  console.log(`  no control data: ${unknown.map(d => d.name).join(", ")}`);

  const sm = stable.filter(d => d.distinctMissed > 0);
  const smv = stable.filter(d => d.distinctViolations > 0);
  console.log(`\n  CONSERVATIVE HEADLINE — stable sites only`);
  console.log(`    ${sm.length}/${stable.length} (${pct(sm.length, stable.length)}) had a finding the baseline missed`);
  console.log(`    ${smv.length}/${stable.length} (${pct(smv.length, stable.length)}) had a VIOLATION the baseline missed`);
  console.log(`    ${sum(stable, d => d.distinctMissed)} distinct findings, median ${median(stable.map(d => d.distinctMissed))} per site`);
}

console.log(`\nCLEAN IN EVERY STATE`);
const clean = ok.filter(d => d.distinctMissed === 0 && d.baseline.violations === 0);
console.log(`  ${clean.length}: ${clean.map(d => d.name).join(", ") || "none"}`);
console.log("");
