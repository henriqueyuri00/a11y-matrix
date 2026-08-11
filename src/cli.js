#!/usr/bin/env node
/*
 * a11y-matrix — run an accessibility check across the user preference states
 * your pipeline currently skips, and report what each one uniquely breaks.
 */
const path = require("path");
const fs = require("fs");
const { runMatrix } = require("./run.js");
const { STATES, selectStates } = require("./states.js");
const { resolvePages } = require("./pages.js");
const { aggregate } = require("./aggregate.js");
const { groupFindings } = require("./grouping.js");

const USAGE = `
a11y-matrix <url|file> [more urls...] [options]

  Runs axe-core across ${STATES.length} user preference states and reports the findings
  that exist in one state but not in the baseline — the ones a single-run
  pipeline structurally cannot see.

Pages
  <url|file>...       one or more pages, or local files
  --sitemap <url>     take pages from a sitemap.xml (follows a sitemap index one level)
  --urls <file>       one URL or path per line; '#' comments allowed
  --max-pages <n>     cap on pages scanned, always announced when it bites (default: 25)

Options
  --states <a,b>    only these states (baseline is always included)
  --tags <a,b>      axe tag filter        (default: wcag2a,wcag2aa,wcag21a,wcag21aa)
  --json <file>     write the full result as JSON
  --markdown <file> write a PR-comment-shaped summary
  --settle <ms>     wait after load before scanning  (default: 400)
  --timeout <ms>    navigation timeout               (default: 30000)
  --fail-on <mode>  unique | any | never             (default: unique)
  --quiet           only print the summary line
  --list-states     print the state matrix and exit

States
${STATES.map(s => "  " + s.id.padEnd(15) + s.label).join("\n")}
`;

function parseArgs(argv) {
  const o = { states: null, tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
              json: null, markdown: null, settle: 400, timeout: 30000,
              failOn: "unique", quiet: false,
              urls: [], sitemap: null, urlsFile: null, maxPages: 25 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error("missing value for " + a);
      return v;
    };
    if (a === "--states") o.states = next().split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--tags") o.tags = next().split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--json") o.json = next();
    else if (a === "--markdown") o.markdown = next();
    else if (a === "--settle") o.settle = Number(next());
    else if (a === "--timeout") o.timeout = Number(next());
    else if (a === "--fail-on") o.failOn = next();
    else if (a === "--sitemap") o.sitemap = next();
    else if (a === "--urls") o.urlsFile = next();
    else if (a === "--max-pages") o.maxPages = Number(next());
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--list-states") o.listStates = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("-")) throw new Error("unknown option: " + a);
    else o.urls.push(a);
  }
  if (!["unique", "any", "never"].includes(o.failOn))
    throw new Error("--fail-on must be one of: unique, any, never");
  if (!Number.isFinite(o.settle) || o.settle < 0) throw new Error("--settle must be a non-negative number");
  if (!Number.isFinite(o.timeout) || o.timeout <= 0) throw new Error("--timeout must be a positive number");
  if (!Number.isFinite(o.maxPages) || o.maxPages < 1) throw new Error("--max-pages must be a positive number");
  return o;
}

const C = process.stdout.isTTY
  ? { dim: "\x1b[2m", red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m",
      bold: "\x1b[1m", off: "\x1b[0m" }
  : { dim: "", red: "", yellow: "", green: "", bold: "", off: "" };

function impactRank(i) { return { critical: 0, serious: 1, moderate: 2, minor: 3, review: 4 }[i] ?? 5; }

function tally(findings) {
  let v = 0, i = 0;
  for (const f of findings) (f.kind === "violation" ? v++ : i++);
  return { violations: v, incomplete: i };
}
function describe(t) {
  const parts = [];
  if (t.violations) parts.push(t.violations + " violation" + (t.violations === 1 ? "" : "s"));
  if (t.incomplete) parts.push(t.incomplete + " needing review");
  return parts.length ? parts.join(", ") : "nothing";
}

function report(results, opts) {
  const lines = [];
  let uniqueTotal = 0, anyTotal = 0;

  for (const r of results) {
    const isBaseline = r.state.id === "baseline";
    anyTotal += r.findings.size;
    uniqueTotal += isBaseline ? 0 : r.uniqueToState.length;

    if (opts.quiet) continue;

    const head = `${C.bold}${r.state.label}${C.off} ${C.dim}(${r.state.id})${C.off}`;
    if (!r.ok) { lines.push(`\n${head}\n  ${C.red}did not load: ${r.error}${C.off}`); continue; }

    if (isBaseline) {
      const t = tally(r.findings.values());
      lines.push(`\n${head}\n  ${describe(t)}` +
                 ` ${C.dim}— this is what your current pipeline sees${C.off}`);
      /* Listed in full. A tool that reports only deltas would leave the reader
         believing the baseline was clean when it merely was not the subject. */
      const base = [...r.findings.values()].sort((a, b) => impactRank(a.impact) - impactRank(b.impact));
      for (const f of base) {
        const mark = f.kind === "incomplete" ? C.yellow + "review  " : C.red + f.impact.padEnd(8);
        lines.push(`    ${mark}${C.off} ${f.rule}  ${C.dim}${f.target}${C.off}`);
      }
      continue;
    }

    const uniq = r.uniqueToState.slice().sort((a, b) => impactRank(a.impact) - impactRank(b.impact));
    if (!uniq.length) {
      const same = r.findings.size;
      lines.push(`\n${head}\n  ${C.green}nothing new${C.off}` +
                 (same ? ` ${C.dim}(${same} finding(s), all also in baseline)${C.off}` : ""));
      if (r.goneFromState.length)
        lines.push(`  ${C.dim}${r.goneFromState.length} baseline finding(s) absent here — usually the element ` +
                   `is not rendered in this state, not that it was fixed.${C.off}`);
      if (r.suppressed)
        lines.push(`  ${C.dim}${r.suppressed} finding(s) suppressed: scrolled out of view inside a ` +
                   `keyboard-reachable scroll container, which is the sanctioned pattern.${C.off}`);
      continue;
    }

    lines.push(`\n${head}  ${C.red}${describe(tally(uniq))} not present in baseline${C.off}`);
    lines.push(`  ${C.dim}${r.state.why}${C.off}`);
    for (const entry of groupFindings(uniq)) {
      if (entry.single) {
        const f = entry.single;
        const mark = f.kind === "incomplete" ? C.yellow + "review  " : C.red + f.impact.padEnd(8);
        lines.push(`    ${mark}${C.off} ${f.rule}  ${C.dim}${f.target}${C.off}`);
        if (f.summary) lines.push(`             ${C.dim}${f.summary.slice(0, 200)}${C.off}`);
        continue;
      }
      const g = entry.group;
      const mark = g.kind === "incomplete" ? C.yellow + "review  " : C.red + String(g.impact).padEnd(8);
      lines.push(`    ${mark}${C.off} ${g.rule}  ${C.bold}x${entry.count}${C.off}  ${C.dim}${g.reason}${C.off}`);
      for (const f of entry.examples) lines.push(`             ${C.dim}e.g. ${f.target}${C.off}`);
      if (entry.count > entry.examples.length)
        lines.push(`             ${C.dim}...and ${entry.count - entry.examples.length} more like it${C.off}`);
    }
    if (r.suppressed)
      lines.push(`  ${C.dim}${r.suppressed} further finding(s) suppressed: scrolled out of view inside a ` +
                 `keyboard-reachable scroll container, which is the sanctioned pattern.${C.off}`);
    if (r.goneFromState.length)
      lines.push(`  ${C.dim}${r.goneFromState.length} baseline violation(s) absent here — usually the element is ` +
                 `not rendered in this state, not that it was fixed.${C.off}`);
  }

  lines.push("");
  if (uniqueTotal === 0) {
    lines.push(`${C.green}No state-specific findings.${C.off} ` +
               `${C.dim}${anyTotal} total finding(s) across ${results.length} states.${C.off}`);
  } else {
    lines.push(`${C.bold}${C.red}${uniqueTotal} finding${uniqueTotal === 1 ? "" : "s"} ` +
               `${uniqueTotal === 1 ? "is" : "are"} invisible to a single-run pipeline.${C.off}`);
    const anyIncomplete = results.some(r => r.state.id !== "baseline" &&
                                            r.uniqueToState.some(f => f.kind === "incomplete"));
    if (anyIncomplete)
      lines.push(`${C.dim}Findings marked ${C.off}${C.yellow}review${C.off}${C.dim} are axe "incomplete" results. ` +
                 `Pipelines that assert only on violations never see them — which is where text at 1:1 ` +
                 `against its own background lands, because axe cannot prove it was not meant to be hidden.${C.off}`);
  }
  return { text: lines.join("\n"), uniqueTotal, anyTotal };
}

function toMarkdown(results, summary) {
  const md = ["## Accessibility state matrix", ""];
  md.push("| State | Total | Not in baseline |");
  md.push("|---|---:|---:|");
  for (const r of results) {
    const uniq = r.state.id === "baseline" ? "&mdash;" : String(r.uniqueToState.length);
    md.push(`| ${r.state.label} | ${r.ok ? r.findings.size : "failed"} | ${uniq} |`);
  }
  md.push("");
  if (summary.uniqueTotal === 0) {
    md.push("No violations were unique to any non-baseline state.");
  } else {
    md.push(`**${summary.uniqueTotal} violation(s) appear only outside the baseline state.**`);
    md.push("");
    for (const r of results) {
      if (r.state.id === "baseline" || !r.uniqueToState.length) continue;
      md.push(`<details><summary>${r.state.label} — ${r.uniqueToState.length}</summary>`, "");
      md.push("> " + r.state.why, "");
      for (const f of r.uniqueToState)
        md.push(`- \`${f.impact}\` **${f.rule}** — \`${f.target}\``);
      md.push("", "</details>", "");
    }
  }
  md.push("", "<sub>Generated by [a11y-matrix](https://github.com/henriqueyuri00/a11y-matrix).</sub>");
  return md.join("\n");
}

/*
 * The site report leads with scope rather than volume. "This defect is on every
 * page you scanned" is a different instruction to a team than "there are 47
 * findings", and it is usually one shared component rather than 47 mistakes.
 */
function reportSite(site, opts) {
  const L = [];
  L.push(`\n${C.bold}${site.pagesScanned} page${site.pagesScanned === 1 ? "" : "s"} scanned${C.off}` +
         (site.pagesFailed.length ? `  ${C.red}${site.pagesFailed.length} failed to load${C.off}` : ""));
  for (const f of site.pagesFailed) L.push(`  ${C.red}${f.url} — ${f.error}${C.off}`);

  L.push(`  ${C.dim}baseline sees ${site.baselineViolations} violation(s) and ` +
         `${site.baselineDistinct - site.baselineViolations} needing review, deduplicated across pages${C.off}`);

  if (!site.distinctMissed) {
    L.push(`\n${C.green}Nothing appears outside the baseline state on any page.${C.off}`);
    if (site.suppressed)
      L.push(`${C.dim}${site.suppressed} finding(s) suppressed as scrolled out of view inside a ` +
             `keyboard-reachable container.${C.off}`);
    return L.join("\n");
  }

  const order = { "every page": 0, "several pages": 1, "one page": 2 };
  const rows = site.findings.slice().sort((a, b) =>
    (order[a.scope] - order[b.scope]) || (b.pageCount - a.pageCount) ||
    (impactRank(a.impact) - impactRank(b.impact)));

  let scope = null;
  for (const f of rows) {
    if (f.scope !== scope) {
      scope = f.scope;
      const note = scope === "every page"
        ? "shared layout — fixing this once fixes it everywhere"
        : scope === "several pages" ? "a shared component, or a repeated pattern"
        : "specific to a single page";
      L.push(`\n${C.bold}${scope}${C.off} ${C.dim}(${note})${C.off}`);
    }
    const mark = f.kind === "incomplete" ? C.yellow + "review  " : C.red + f.impact.padEnd(8);
    L.push(`  ${mark}${C.off} ${f.rule}  ${C.dim}${f.target}${C.off}`);
    L.push(`           ${C.dim}${f.pageCount} page(s) · exposed by: ${f.states.join(", ")}${C.off}`);
  }

  L.push("");
  L.push(`${C.bold}${C.red}${site.distinctMissed} distinct finding(s) ` +
         `(${site.distinctViolations} violation) are invisible to a single-state run.${C.off}`);
  if (site.suppressed)
    L.push(`${C.dim}${site.suppressed} further finding(s) suppressed as scrolled out of view inside a ` +
           `keyboard-reachable container.${C.off}`);
  return L.join("\n");
}

function siteMarkdown(site) {
  const md = ["## Accessibility state matrix", "",
              `${site.pagesScanned} page(s) scanned.` +
              (site.pagesFailed.length ? ` ${site.pagesFailed.length} failed to load.` : "")];
  if (!site.distinctMissed) {
    md.push("", "Nothing appears outside the baseline state on any page.");
  } else {
    md.push("", `**${site.distinctMissed} distinct finding(s) are invisible to a single-state run** ` +
                `(${site.distinctViolations} classed as violations).`, "");
    md.push("| Scope | Pages | Rule | Element | Exposed by |");
    md.push("|---|---:|---|---|---|");
    const order = { "every page": 0, "several pages": 1, "one page": 2 };
    for (const f of site.findings.slice().sort((a, b) => order[a.scope] - order[b.scope] || b.pageCount - a.pageCount))
      md.push(`| ${f.scope} | ${f.pageCount} | \`${f.rule}\` | \`${f.target}\` | ${f.states.join(", ")} |`);
  }
  md.push("", "<sub>Generated by [a11y-matrix](https://github.com/henriqueyuri00/a11y-matrix).</sub>");
  return md.join("\n");
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(C.red + e.message + C.off + "\n" + USAGE); process.exit(2); }

  if (opts.help) { console.log(USAGE); return; }
  if (opts.listStates) {
    for (const s of STATES) console.log(`\n${C.bold}${s.id}${C.off}  ${s.label}\n  ${C.dim}${s.why}${C.off}`);
    return;
  }
  let pages, states;
  try {
    states = selectStates(opts.states);
    pages = await resolvePages(opts, (found, cap) =>
      console.error(`${C.yellow}${found} pages found, scanning the first ${cap}. ` +
                    `Raise --max-pages to cover the rest.${C.off}`));
  } catch (e) { console.error(C.red + e.message + C.off + "\n" + USAGE); process.exit(2); }

  const runOpts = { tags: opts.tags, settle: opts.settle, timeout: opts.timeout };

  /* Single page keeps the original output verbatim. The per-state detail is
     what a person debugging one page wants, and collapsing it into a site
     rollup would be a downgrade for the common case. */
  if (pages.length === 1) {
    const url = pages[0];
    if (!opts.quiet) console.error(`${C.dim}scanning ${url} across ${states.length} states${C.off}`);
    let results;
    try {
      results = await runMatrix(url, states, { ...runOpts,
        onState: s => { if (!opts.quiet) process.stderr.write(`${C.dim}  · ${s.id}${C.off}\n`); } });
    } catch (e) { console.error(C.red + e.message + C.off); process.exit(2); }

    const summary = report(results, opts);
    console.log(summary.text);

    if (opts.json) {
      fs.writeFileSync(opts.json, JSON.stringify({
        url, generatedFor: states.map(s => s.id),
        states: results.map(r => ({
          id: r.state.id, label: r.state.label, ok: r.ok, error: r.error || null,
          total: r.findings.size,
          findings: [...r.findings.values()],
          uniqueToState: r.uniqueToState,
          alsoInBaseline: r.alsoInBaseline.length,
          goneFromState: r.goneFromState
        })),
        uniqueTotal: summary.uniqueTotal
      }, null, 2));
    }
    if (opts.markdown) fs.writeFileSync(opts.markdown, toMarkdown(results, summary));

    const fail = opts.failOn === "never" ? false
               : opts.failOn === "any"   ? summary.anyTotal > 0
               :                           summary.uniqueTotal > 0;
    process.exit(fail ? 1 : 0);
  }

  /* ---------------------------------------------------------------- site */
  if (!opts.quiet)
    console.error(`${C.dim}scanning ${pages.length} pages across ${states.length} states each` +
                  ` (${pages.length * states.length} loads)${C.off}`);

  const perPage = [];
  for (const [i, url] of pages.entries()) {
    if (!opts.quiet) process.stderr.write(`${C.dim}  [${i + 1}/${pages.length}] ${url}${C.off}\n`);
    try {
      perPage.push({ url, ok: true, results: await runMatrix(url, states, runOpts) });
    } catch (e) {
      perPage.push({ url, ok: false, error: e.message, results: [] });
      process.stderr.write(`${C.red}      failed: ${e.message}${C.off}\n`);
    }
  }

  const site = aggregate(perPage);
  console.log(reportSite(site, opts));

  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({
    pages, generatedFor: states.map(s => s.id), ...site
  }, null, 2));
  if (opts.markdown) fs.writeFileSync(opts.markdown, siteMarkdown(site));

  const fail = opts.failOn === "never" ? false
             : opts.failOn === "any"   ? site.distinctMissed + site.baselineDistinct > 0
             :                           site.distinctMissed > 0;
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
