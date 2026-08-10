/*
 * Runs axe once per state and works out what each state uniquely breaks.
 *
 * The interesting output is not the violation list — axe already gives you
 * that. It is the set difference: violations present in a state and absent
 * from the baseline. Those are, by construction, exactly the defects an
 * ordinary single-run pipeline cannot see, no matter how green it is.
 */
const fs = require("fs");
const path = require("path");

const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/* A finding instance is a (kind, rule, element) triple. The failure summary is
   deliberately NOT part of the key: in dark mode a contrast failure reports
   different colour values for the same element, and that is the same defect
   surfacing, not a new one. Keying on the summary would report it as unique to
   every state and make the delta meaningless.

   The kind IS part of the key, so that a finding which is merely "needs review"
   in the baseline and a hard failure in another state registers as a delta
   rather than being swallowed as already-known. */
function key(kind, ruleId, node) {
  return kind + " " + ruleId + " @ " + (node.target || []).join(" ");
}

/*
 * axe splits results into violations and incomplete. Almost every pipeline
 * asserts on violations only, and this fixture shows why that is a mistake:
 * text at exactly 1:1 against its own background — literally invisible — is
 * reported as INCOMPLETE, not as a violation, because axe cannot rule out that
 * the element is decorative or deliberately hidden. So the most severe
 * contrast defect there is lands in the bucket everyone discards. Both buckets
 * are collected here and kept distinct in the output.
 */
function normalise(results) {
  const out = new Map();
  for (const [kind, list] of [["violation", results.violations], ["incomplete", results.incomplete]]) {
    for (const v of list || []) {
      for (const node of v.nodes) {
        out.set(key(kind, v.id, node), {
          kind,
          rule: v.id,
          impact: node.impact || v.impact || (kind === "incomplete" ? "review" : "minor"),
          help: v.help,
          helpUrl: v.helpUrl,
          target: (node.target || []).join(" "),
          summary: (node.failureSummary || "").replace(/\s+/g, " ").trim()
        });
      }
    }
  }
  return out;
}

async function runState(browser, url, state, opts) {
  const context = await browser.newContext({
    viewport: state.viewport,
    reducedMotion: state.media.reducedMotion,
    colorScheme: state.media.colorScheme,
    forcedColors: state.media.forcedColors
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: opts.timeout });
    /* networkidle is not reliable on pages with polling or open sockets, and
       waiting on it turns a 2s check into a 30s timeout. A short settle after
       load covers webfont swap and above-the-fold hydration, which is what
       actually moves contrast values. */
    await page.waitForTimeout(opts.settle);

    await page.addScriptTag({ content: AXE_SOURCE });
    /* resultTypes is deliberately not set. Restricting it to "violations"
       makes axe return only a single representative node for every other
       bucket, which silently truncates the incomplete results this tool exists
       to surface. */
    const results = await page.evaluate(async (tags) => {
      /* eslint-disable no-undef */
      return await axe.run(document, { runOnly: { type: "tag", values: tags } });
    }, opts.tags);

    return { ok: true, findings: normalise(results) };
  } catch (err) {
    return { ok: false, error: err.message, findings: new Map() };
  } finally {
    await context.close();
  }
}

/*
 * forced-colors deserves a caveat rather than silent results. In that mode the
 * OS overrides colours, so axe's contrast rule is measuring the forced palette
 * and not the author's. Reporting a contrast "fix" there would be a lie, so
 * contrast findings are dropped from that state and the reason is surfaced.
 */
function filterForState(state, findings) {
  if (state.id !== "forced-colors") return findings;
  const kept = new Map();
  for (const [k, f] of findings) if (f.rule !== "color-contrast") kept.set(k, f);
  return kept;
}

async function runMatrix(url, states, opts) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const perState = [];
  try {
    for (const state of states) {
      opts.onState && opts.onState(state);
      const r = await runState(browser, url, state, opts);
      perState.push({ state, ...r, findings: filterForState(state, r.findings) });
    }
  } finally {
    await browser.close();
  }

  const baseline = perState.find(r => r.state.id === "baseline");
  if (!baseline) throw new Error("baseline state did not run");
  if (!baseline.ok) throw new Error("baseline state failed to load: " + baseline.error);

  return perState.map(r => {
    const uniqueToState = [];
    const alsoInBaseline = [];
    for (const [k, f] of r.findings) {
      (baseline.findings.has(k) ? alsoInBaseline : uniqueToState).push(f);
    }
    /* Violations the baseline has that this state does not. Usually a layout
       change removed the element rather than fixed it, so this is reported as
       information, never as a pass. */
    const goneFromState = [];
    if (r.state.id !== "baseline") {
      for (const [k, f] of baseline.findings) if (!r.findings.has(k)) goneFromState.push(f);
    }
    return { ...r, uniqueToState, alsoInBaseline, goneFromState };
  });
}

module.exports = { runMatrix, normalise, key };
