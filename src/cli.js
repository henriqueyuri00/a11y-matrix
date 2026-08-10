#!/usr/bin/env node
/*
 * a11y-matrix — run an accessibility check across the user preference states
 * your pipeline currently skips, and report what each one uniquely breaks.
 */
const path = require("path");
const fs = require("fs");
const { runMatrix } = require("./run.js");
const { STATES, selectStates } = require("./states.js");

const USAGE = `
a11y-matrix <url|file> [options]

  Runs axe-core across ${STATES.length} user preference states and reports the violations
  that exist in one state but not in the baseline — the ones a single-run
  pipeline structurally cannot see.

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
              failOn: "unique", quiet: false, url: null };
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
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--list-states") o.listStates = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("-")) throw new Error("unknown option: " + a);
    else if (o.url === null) o.url = a;
    else throw new Error("unexpected argument: " + a);
  }
  if (!["unique", "any", "never"].includes(o.failOn))
    throw new Error("--fail-on must be one of: unique, any, never");
  if (!Number.isFinite(o.settle) || o.settle < 0) throw new Error("--settle must be a non-negative number");
  if (!Number.isFinite(o.timeout) || o.timeout <= 0) throw new Error("--timeout must be a positive number");
  return o;
}

/* A bare path is far more common than a file:// URL on the command line, and
   getting it wrong yields an opaque navigation error, so resolve it here. */
function toUrl(target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error("no such file: " + abs);
  return "file:///" + abs.replace(/\\/g, "/");
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
    for (const f of uniq) {
      const mark = f.kind === "incomplete" ? C.yellow + "review  " : C.red + f.impact.padEnd(8);
      lines.push(`    ${mark}${C.off} ${f.rule}  ${C.dim}${f.target}${C.off}`);
      if (f.summary) lines.push(`             ${C.dim}${f.summary.slice(0, 200)}${C.off}`);
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

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(C.red + e.message + C.off + "\n" + USAGE); process.exit(2); }

  if (opts.help) { console.log(USAGE); return; }
  if (opts.listStates) {
    for (const s of STATES) console.log(`\n${C.bold}${s.id}${C.off}  ${s.label}\n  ${C.dim}${s.why}${C.off}`);
    return;
  }
  if (!opts.url) { console.error(C.red + "a target url or file is required" + C.off + "\n" + USAGE); process.exit(2); }

  let url, states;
  try { url = toUrl(opts.url); states = selectStates(opts.states); }
  catch (e) { console.error(C.red + e.message + C.off); process.exit(2); }

  if (!opts.quiet) console.error(`${C.dim}scanning ${url} across ${states.length} states${C.off}`);

  let results;
  try {
    results = await runMatrix(url, states, {
      tags: opts.tags, settle: opts.settle, timeout: opts.timeout,
      onState: s => { if (!opts.quiet) process.stderr.write(`${C.dim}  · ${s.id}${C.off}\n`); }
    });
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

main().catch(e => { console.error(e); process.exit(2); });
