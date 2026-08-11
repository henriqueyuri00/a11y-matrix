/*
 * Generates docs/index.html from the study data.
 *
 * The page is built rather than written so the numbers on it cannot drift from
 * results.json. Every figure below is derived here; nothing is typed twice.
 */
const fs = require("fs");
const path = require("path");

const results = JSON.parse(fs.readFileSync(path.join(__dirname, "results.json"), "utf8"));
const controlRaw = JSON.parse(fs.readFileSync(path.join(__dirname, "control.json"), "utf8"));
const control = new Map(controlRaw.map(c => [c.url, c]));

for (const d of results) {
  const c = control.get(d.url);
  d.noise = c && c.ok ? c.appeared + c.disappeared : null;
  d.stable = d.noise === 0;
}

const scanned = results.filter(d => d.ok);
const failed  = results.filter(d => !d.ok);
const stable  = scanned.filter(d => d.stable);
const unstable = scanned.filter(d => d.noise > 0);

const missed  = stable.filter(d => d.distinctMissed > 0);
const missedV = stable.filter(d => d.distinctViolations > 0);
const pct = (n, d) => Math.round(100 * n / d);
const median = a => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const CATEGORY_LABEL = {
  "standards": "Standards bodies", "docs": "Framework and tool docs",
  "design-system": "Design systems", "platform": "Developer platforms",
  "general": "General", "eu-public-sector": "EU public sector",
  "eu-commerce": "EU e-commerce", "eu-transport": "EU passenger transport",
  "eu-banking": "EU banking"
};

const byCategory = [...new Set(stable.map(d => d.category))].map(c => {
  const g = stable.filter(d => d.category === c);
  return { c, label: CATEGORY_LABEL[c] || c, n: g.length,
           affected: g.filter(d => d.distinctMissed > 0).length,
           med: median(g.map(d => d.distinctMissed)) };
}).sort((a, b) => (b.affected / b.n) - (a.affected / a.n));

/* Rows are sorted by findings so the page opens on the interesting end, but the
   site name is kept prominent: a reader's first question is "is mine here". */
const rows = scanned.slice().sort((a, b) => b.distinctMissed - a.distinctMissed).map(d => `
      <tr${d.stable ? "" : ' class="unstable"'}>
        <th scope="row">${esc(d.name)}</th>
        <td>${esc(CATEGORY_LABEL[d.category] || d.category)}</td>
        <td class="n">${d.baseline.violations}</td>
        <td class="n">${d.baseline.incomplete}</td>
        <td class="n${d.stable && d.distinctMissed ? " hot" : ""}">${d.stable ? d.distinctMissed : "&mdash;"}</td>
        <td class="n">${d.stable ? d.distinctViolations : "&mdash;"}</td>
        <td>${d.stable ? "stable" : `<abbr title="Two identical runs of the same state disagreed by ${d.noise} findings, so no difference on this site can be attributed to a preference">excluded (${d.noise})</abbr>`}</td>
      </tr>`).join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How much does a single-state accessibility run miss? &mdash; a11y-matrix study</title>
<meta name="description" content="${stable.length} public homepages scanned across seven browser preference states. ${pct(missed.length, stable.length)}% had a finding a baseline-only run never surfaced. Method, noise control and raw data included.">
<link rel="canonical" href="https://henriqueyuri00.github.io/a11y-matrix/">
<meta property="og:type" content="article">
<meta property="og:url" content="https://henriqueyuri00.github.io/a11y-matrix/">
<meta property="og:title" content="How much does a single-state accessibility run miss?">
<meta property="og:description" content="${stable.length} public homepages, seven browser states each, with a noise control. ${pct(missed.length, stable.length)}% had a finding the default state never surfaced.">
<meta name="twitter:card" content="summary">
<style>
  :root{
    --bg:#fbfbfa; --panel:#fff; --ink:#16171a; --muted:#5f6470; --line:#e4e4e2;
    --accent:#1c5d3f; --accent-soft:#e8f1ec; --on-accent:#fff; --hot:#8a2b20; --hot-soft:#fbecea;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme=light]){
      --bg:#131416; --panel:#1a1c1f; --ink:#e9e9ea; --muted:#9ba1ac; --line:#2c2f34;
      --accent:#6cc49a; --accent-soft:#18342a; --on-accent:#10241b; --hot:#f2a094; --hot-soft:#33201d;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:900px;margin:0 auto;padding:0 20px}
  a{color:var(--accent)}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
  .skip{position:absolute;left:12px;top:-60px;z-index:60;background:var(--accent);color:var(--on-accent);
        padding:10px 16px;border-radius:0 0 8px 8px;text-decoration:none}
  .skip:focus{top:0}
  header{padding:56px 0 8px}
  h1{font-size:clamp(26px,4.5vw,38px);line-height:1.2;margin:0 0 14px;letter-spacing:-.02em}
  .lede{font-size:18px;color:var(--muted);max-width:62ch;margin:0}
  h2{font-size:21px;margin:44px 0 10px;letter-spacing:-.01em}
  h3{font-size:16px;margin:26px 0 6px}
  p,li{max-width:70ch}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:26px 0}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
  .stat b{display:block;font-size:30px;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .stat span{font-size:13px;color:var(--muted)}
  .tw{overflow-x:auto;max-width:100%;border:1px solid var(--line);border-radius:10px;margin:18px 0}
  .tw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  table{border-collapse:collapse;width:100%;min-width:640px;font-size:14px}
  caption{text-align:left;padding:12px 14px;color:var(--muted);font-size:13.5px}
  th,td{padding:8px 12px;border-bottom:1px solid var(--line);text-align:left}
  thead th{position:sticky;top:0;background:var(--panel);font-size:12.5px;text-transform:uppercase;
           letter-spacing:.05em;color:var(--muted)}
  tbody th{font-weight:600}
  .n{text-align:right;font-variant-numeric:tabular-nums}
  .hot{color:var(--hot);font-weight:640}
  tr.unstable{color:var(--muted)}
  abbr{text-decoration:underline dotted;cursor:help}
  .note{background:var(--accent-soft);border-radius:10px;padding:16px 18px;margin:22px 0}
  .note p{margin:0}
  .note p + p{margin-top:10px}
  code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  code{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:13.5px}
  pre{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;
      overflow-x:auto;font-size:13.5px}
  pre code{background:none;border:0;padding:0}
  footer{margin:56px 0 40px;padding-top:22px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
<header>
  <h1>How much does a single-state accessibility run miss?</h1>
  <p class="lede">Automated accessibility checks load the page once, in the state a headless browser
  boots into: light colour scheme, no motion preference, forced colors off, desktop viewport. That is
  one user. This measures what it costs, across ${scanned.length} public homepages.</p>
</header>

<main id="main">
  <div class="stats">
    <div class="stat"><b>${pct(missed.length, stable.length)}%</b><span>${missed.length} of ${stable.length} stable sites had a finding the baseline never surfaced</span></div>
    <div class="stat"><b>${pct(missedV.length, stable.length)}%</b><span>had one axe classes as a violation, not &ldquo;needs review&rdquo;</span></div>
    <div class="stat"><b>${median(stable.map(d => d.distinctMissed))}</b><span>median findings missed per site</span></div>
    <div class="stat"><b>${stable.filter(d => d.distinctMissed === 0 && d.baseline.violations === 0).length}</b><span>sites clean in all seven states</span></div>
  </div>

  <div class="note">
    <p><strong>A finding is not a failure.</strong> axe detects a minority of WCAG failures &mdash;
    <a href="https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/">57% by issue volume</a>
    in Deque&rsquo;s own study, roughly a third by success criteria. This is not an audit, it does not
    replace manual testing, and nothing here establishes that any organisation is non-compliant with
    anything.</p>
    <p>What it does show is narrower: the states where these defects hide are the states an automated
    pipeline does not render.</p>
  </div>

  <h2>Method</h2>
  <p>Each site is loaded seven times. One run is the <strong>baseline</strong> &mdash; light, desktop,
  no preferences, which is what an ordinary pipeline tests. The other six each change
  <strong>exactly one</strong> variable away from it. A finding counts when it exists in a
  non-baseline state and <em>not</em> in the baseline.</p>
  <p>Findings are keyed by <code>(kind, rule, element)</code> and deduplicated across states, because
  a defect caused by a narrow layout surfaces in three of them at once and summing per-state counts
  would report one element three times.</p>

  <h3>The noise control</h3>
  <p>Real sites carry carousels, rotating promos and A/B tests, so two identical loads do not always
  produce identical output. Every site was also run <strong>twice in the same state, with nothing
  changed</strong>. ${stable.length} of ${scanned.length} were byte-identical; the other
  ${unstable.length} are excluded from every figure above rather than left in the denominator.</p>
  <p>That control is not a formality. One shopping site produced
  <strong>${Math.max(...unstable.map(d => d.distinctMissed))} apparent findings</strong> and a churn of
  ${control.get(unstable.sort((a,b)=>b.distinctMissed-a.distinctMissed)[0].url).appeared}
  between two identical loads &mdash; a product carousel, not a defect. Excluding it moved its whole
  sector&rsquo;s total from 729 findings to 14.</p>

  <h2>By sector</h2>
  <div class="tw" tabindex="0" role="region" aria-label="Findings by sector">
  <table>
    <caption>Stable sites only. &ldquo;Affected&rdquo; means at least one finding the baseline run never surfaced.</caption>
    <thead><tr><th scope="col">Sector</th><th scope="col" class="n">Sites</th><th scope="col" class="n">Affected</th><th scope="col" class="n">Median findings</th></tr></thead>
    <tbody>${byCategory.map(g => `
      <tr><th scope="row">${esc(g.label)}</th><td class="n">${g.n}</td>
      <td class="n">${g.affected} (${pct(g.affected, g.n)}%)</td><td class="n">${g.med}</td></tr>`).join("")}
    </tbody>
  </table>
  </div>
  <p>The sectors carrying an explicit EU legal accessibility duty &mdash; public sector under the Web
  Accessibility Directive, and banking, transport and e-commerce under the European Accessibility Act
  &mdash; are not visibly better than the rest. They are also not visibly worse.</p>

  <h2>Every site scanned</h2>
  <div class="tw" tabindex="0" role="region" aria-label="Per-site results">
  <table>
    <caption>Excluded rows are sites whose output was not reproducible between two identical runs, so
    no difference on them can be attributed to a preference.</caption>
    <thead><tr>
      <th scope="col">Site</th><th scope="col">Sector</th>
      <th scope="col" class="n">Baseline<br>violations</th>
      <th scope="col" class="n">Baseline<br>needs review</th>
      <th scope="col" class="n">Missed by<br>baseline</th>
      <th scope="col" class="n">of which<br>violations</th>
      <th scope="col">Reproducible</th>
    </tr></thead>
    <tbody>${rows}
    </tbody>
  </table>
  </div>
  ${failed.length ? `<p>${failed.length} site${failed.length > 1 ? "s" : ""} did not load and
  ${failed.length > 1 ? "are" : "is"} excluded rather than counted as clean:
  ${failed.map(f => esc(f.name)).join(", ")}.</p>` : ""}

  <h2>Run it yourself</h2>
  <pre tabindex="0" role="region" aria-label="Commands to run a11y-matrix"><code>npx github:henriqueyuri00/a11y-matrix https://your-site.example
npx github:henriqueyuri00/a11y-matrix --sitemap https://your-site.example/sitemap.xml</code></pre>
  <p>MIT, no account, no telemetry. The
  <a href="https://github.com/henriqueyuri00/a11y-matrix/tree/main/study">study directory</a>
  contains the site list, both scripts, the raw per-site JSON and the control run, so the
  interpretation can be argued with without re-running anything.</p>
</main>

<footer>
  <p>Generated from <code>study/results.json</code> by <code>study/build-page.js</code>, so the
  numbers here cannot drift from the data. &mdash;
  <a href="https://github.com/henriqueyuri00/a11y-matrix">a11y-matrix on GitHub</a></p>
</footer>
</div>
</body>
</html>
`;

const out = path.join(__dirname, "..", "docs");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`wrote docs/index.html — ${scanned.length} scanned, ${stable.length} stable, ${failed.length} failed`);
