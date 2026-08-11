/*
 * The control the study is worthless without.
 *
 * Real sites carry carousels, rotating promos, A/B tests and lazy-loaded
 * content. Two identical loads of the same page do not necessarily produce
 * identical axe output. So a finding that appears in the dark-mode run and not
 * in the baseline might be a genuine colour-scheme defect — or it might be that
 * a different hero image happened to render.
 *
 * This measures that noise floor directly: the SAME state, twice, with nothing
 * changed between the two runs. Anything reported as "unique" here is churn,
 * not signal. The study's headline number only means something if it clears
 * this figure by a wide margin.
 */
const fs = require("fs");
const path = require("path");
const { runMatrix } = require("../src/run.js");
const { STATES } = require("../src/states.js");

const SITES = JSON.parse(fs.readFileSync(path.join(__dirname, "sites.json"), "utf8"));
const OUT = path.join(__dirname, "control.json");

const base = STATES.find(s => s.id === "baseline");
/* Same viewport, same media, same everything. Only the id differs, because the
   delta is always computed against the state literally called "baseline". */
const CONTROL_STATES = [base, { ...base, id: "baseline-repeat", label: "Baseline, run again",
                                why: "Identical to the baseline. Any difference is measurement noise." }];

const OPTS = { tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], settle: 1200, timeout: 45000 };

(async () => {
  const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
  const seen = new Set(done.map(d => d.url));
  const todo = SITES.filter(s => !seen.has(s.url));
  console.log(`${done.length} already done, ${todo.length} to go\n`);

  for (const site of todo) {
    process.stdout.write(site.name.padEnd(22));
    try {
      const r = await runMatrix(site.url, CONTROL_STATES, OPTS);
      const repeat = r.find(x => x.state.id === "baseline-repeat");
      const rec = {
        url: site.url, name: site.name, ok: r.every(x => x.ok),
        /* Churn in both directions: findings the second run invented, and
           findings it lost. A study that only counted one would understate. */
        appeared: repeat.uniqueToState.length,
        disappeared: repeat.goneFromState.length,
        baselineTotal: r.find(x => x.state.id === "baseline").findings.size
      };
      done.push(rec);
      console.log(`total ${String(rec.baselineTotal).padStart(3)}   ` +
                  `appeared ${rec.appeared}   disappeared ${rec.disappeared}`);
    } catch (e) {
      done.push({ url: site.url, name: site.name, ok: false, error: e.message });
      console.log("FAILED  " + e.message.slice(0, 60));
    }
    fs.writeFileSync(OUT, JSON.stringify(done, null, 2));
  }

  const ok = done.filter(d => d.ok);
  const churn = ok.filter(d => d.appeared > 0 || d.disappeared > 0);
  console.log(`\nNOISE FLOOR`);
  console.log(`  ${churn.length}/${ok.length} sites differed between two identical runs`);
  console.log(`  ${ok.reduce((t, d) => t + d.appeared, 0)} findings appeared, ` +
              `${ok.reduce((t, d) => t + d.disappeared, 0)} disappeared, with nothing changed`);
  if (churn.length) console.log(`  unstable: ${churn.map(d => d.name + "(+" + d.appeared + "/-" + d.disappeared + ")").join(", ")}`);
})();
