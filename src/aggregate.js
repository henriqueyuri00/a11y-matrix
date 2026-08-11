/*
 * Rolling many pages up into one answer.
 *
 * The naive report for a 50-page scan lists the same header contrast defect 50
 * times. That is not 50 problems; it is one problem in a shared component, and
 * presenting it as 50 buries the handful of findings that are genuinely
 * page-specific. So findings are keyed by (kind, rule, element) across pages,
 * and the page count becomes the interesting number rather than the volume.
 */

const keyOf = f => f.kind + "|" + f.rule + "|" + f.target;

function aggregate(perPage) {
  const scanned = perPage.filter(p => p.ok);
  const failed = perPage.filter(p => !p.ok);

  /* key -> { finding, pages:Set, states:Set } for findings absent from that
     page's own baseline — the thing this tool exists to surface. */
  const missed = new Map();
  /* Baseline findings are rolled up the same way, so the report can say what
     an ordinary pipeline would already have told you. */
  const baseline = new Map();

  for (const page of scanned) {
    for (const r of page.results) {
      if (r.state.id === "baseline") {
        for (const f of r.findings.values()) {
          const k = keyOf(f);
          if (!baseline.has(k)) baseline.set(k, { finding: f, pages: new Set() });
          baseline.get(k).pages.add(page.url);
        }
        continue;
      }
      for (const f of r.uniqueToState) {
        const k = keyOf(f);
        if (!missed.has(k)) missed.set(k, { finding: f, pages: new Set(), states: new Set() });
        const e = missed.get(k);
        e.pages.add(page.url);
        e.states.add(r.state.id);
      }
    }
  }

  const total = scanned.length;
  const rows = [...missed.values()].map(e => ({
    ...e.finding,
    pages: [...e.pages],
    pageCount: e.pages.size,
    states: [...e.states],
    /* "Everywhere" is only meaningful with more than one page to compare. A
       single-page scan is not evidence that anything is site-wide. */
    scope: total > 1 && e.pages.size === total ? "every page"
         : e.pages.size > 1                    ? "several pages"
         :                                       "one page"
  }));

  return {
    pagesScanned: total,
    pagesFailed: failed.map(p => ({ url: p.url, error: p.error })),
    distinctMissed: rows.length,
    distinctViolations: rows.filter(r => r.kind === "violation").length,
    baselineDistinct: baseline.size,
    baselineViolations: [...baseline.values()].filter(e => e.finding.kind === "violation").length,
    findings: rows,
    /* Suppressions are summed rather than deduplicated: the count is a
       transparency figure about decisions taken, not a defect count. */
    suppressed: scanned.reduce((t, p) =>
      t + p.results.reduce((s, r) => s + (r.suppressed || 0), 0), 0)
  };
}

module.exports = { aggregate, keyOf };
