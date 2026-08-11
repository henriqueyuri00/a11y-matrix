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
   two DIFFERENT runs was caused by the preference. */
const controlPath = path.join(__dirname, "control.json");
const control = fs.existsSync(controlPath)
  ? new Map(JSON.parse(fs.readFileSync(controlPath, "utf8")).map(c => [c.url, c]))
  : new Map();

for (const d of data) {
  const c = control.get(d.url);
  d.noise = c && c.ok ? c.appeared + c.disappeared : null;
  d.stable = d.noise === 0;
}

const scanned  = data.filter(d => d.ok);
const failed   = data.filter(d => !d.ok);
const stable   = scanned.filter(d => d.stable);
const unstable = scanned.filter(d => d.noise !== null && d.noise > 0);
const unknown  = scanned.filter(d => d.noise === null);

/*
 * Every figure below is computed on ONE basis, and it is the conservative one
 * whenever the control has been run.
 *
 * Mixing bases is how a report ends up excluding a site as unstable in one
 * section and quoting that same site's noise as a category total three lines
 * later. An earlier version of this script did exactly that: a shopping site
 * whose carousel produced 715 phantom findings was correctly dropped from the
 * headline and then silently dominated the sector breakdown.
 */
const basis = control.size ? stable : scanned;
const BASIS = control.size ? "stable sites only" : "all scanned sites (no control run)";

const pct = (n, d) => d === 0 ? "-" : (100 * n / d).toFixed(0) + "%";
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const median = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

console.log(`\nSAMPLE`);
console.log(`  ${data.length} attempted, ${scanned.length} scanned, ${failed.length} failed to load`);
if (failed.length) console.log(`  failed: ${failed.map(f => f.name).join(", ")}`);

if (control.size) {
  console.log(`\nNOISE CONTROL  (same state twice, nothing changed between runs)`);
  console.log(`  ${stable.length}/${scanned.length} produced identical output across two identical runs`);
  const app = sum(unstable, d => control.get(d.url).appeared);
  const dis = sum(unstable, d => control.get(d.url).disappeared);
  console.log(`  ${app} findings appeared and ${dis} disappeared with nothing changed`);
  if (unstable.length) console.log(`  excluded as unstable: ${unstable.map(d => `${d.name}(${d.noise})`).join(", ")}`);
  if (unknown.length)  console.log(`  no control data: ${unknown.map(d => d.name).join(", ")}`);
}

console.log(`\n--- everything below is computed on ${BASIS}: ${basis.length} sites ---`);

const missed  = basis.filter(d => d.distinctMissed > 0);
const missedV = basis.filter(d => d.distinctViolations > 0);

console.log(`\nHEADLINE`);
console.log(`  ${missed.length}/${basis.length} (${pct(missed.length, basis.length)}) had at least one finding a baseline-only run did not surface`);
console.log(`  ${missedV.length}/${basis.length} (${pct(missedV.length, basis.length)}) had at least one such finding axe classes as a VIOLATION`);

console.log(`\nVOLUME  (deduplicated across states)`);
console.log(`  baseline violations across the sample  : ${sum(basis, d => d.baseline.violations)}`);
console.log(`  baseline incomplete                    : ${sum(basis, d => d.baseline.incomplete)}`);
console.log(`  distinct findings missed by baseline   : ${sum(basis, d => d.distinctMissed)}`);
console.log(`    of which violations                  : ${sum(basis, d => d.distinctViolations)}`);
console.log(`  median missed per site                 : ${median(basis.map(d => d.distinctMissed))}`);
console.log(`  worst single site                      : ${Math.max(0, ...basis.map(d => d.distinctMissed))}`);

console.log(`\nWHAT EXPOSED IT`);
/* Attribution is by group, not by single state: narrow-viewport states overlap
   by construction, so naming one of three as "the" cause would be arbitrary. */
const GROUPS = {
  "narrow viewport": ["mobile", "reflow-320", "dark-mobile"],
  "dark scheme":     ["dark", "dark-mobile"],
  "reduced motion":  ["reduced-motion"],
  "forced colors":   ["forced-colors"]
};
for (const [label, ids] of Object.entries(GROUPS)) {
  let sites = 0, findings = 0;
  for (const d of basis) {
    const keys = new Set(ids.flatMap(id => d.byState[id]?.keys || []));
    if (keys.size) { sites++; findings += keys.size; }
  }
  console.log(`  ${label.padEnd(18)} ${String(sites).padStart(3)} sites   ${String(findings).padStart(4)} distinct findings`);
}
/* Exposed by a dark state and by nothing narrow, so the colour scheme is the
   only variable that can explain it. */
let darkOnlySites = 0, darkOnly = 0;
for (const d of basis) {
  const narrow = new Set(["mobile", "reflow-320"].flatMap(id => d.byState[id]?.keys || []));
  const dark   = new Set(["dark", "dark-mobile"].flatMap(id => d.byState[id]?.keys || []));
  const only   = [...dark].filter(k => !narrow.has(k));
  if (only.length) { darkOnlySites++; darkOnly += only.length; }
}
console.log(`  ${"dark scheme ALONE".padEnd(18)} ${String(darkOnlySites).padStart(3)} sites   ${String(darkOnly).padStart(4)} distinct findings`);

console.log(`\nRULES INVOLVED  (sites where the rule fired outside the baseline)`);
const ruleCount = {};
for (const d of basis) for (const r of d.rules || []) ruleCount[r] = (ruleCount[r] || 0) + 1;
Object.entries(ruleCount).sort((a, b) => b[1] - a[1])
  .forEach(([r, c]) => console.log(`  ${String(c).padStart(3)} sites  ${r}`));

console.log(`\nBY CATEGORY`);
for (const c of [...new Set(basis.map(d => d.category))]) {
  const g = basis.filter(d => d.category === c);
  const m = g.filter(d => d.distinctMissed > 0).length;
  console.log(`  ${c.padEnd(18)} ${m}/${g.length} affected (${pct(m, g.length)}), ` +
              `${sum(g, d => d.distinctMissed)} distinct findings, median ${median(g.map(d => d.distinctMissed))}`);
}

console.log(`\nCLEAN IN EVERY STATE`);
const clean = basis.filter(d => d.distinctMissed === 0 && d.baseline.violations === 0);
console.log(`  ${clean.length}: ${clean.map(d => d.name).join(", ") || "none"}`);
console.log("");
