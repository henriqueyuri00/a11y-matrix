/*
 * Collapse repeats instead of hiding them.
 *
 * Some axe results fire once per element on a page that has a hundred similar
 * elements. "Element content is too short to determine if it is actual text
 * content" is the worst offender: it lands on every numeric table cell, so a
 * page containing a results table produces well over a hundred identical lines
 * and buries the one real violation underneath them.
 *
 * Suppressing them would be the easy fix and the wrong one — a short label
 * really can have a contrast problem. So identical (kind, rule, reason) results
 * are printed once with a count and a couple of examples. Nothing is dropped,
 * and the count is the part that says "this is a pattern", which a list of a
 * hundred lines does not.
 */
function groupFindings(findings, { threshold = 4, examples = 2 } = {}) {
  const groups = new Map();
  for (const f of findings) {
    /* Key on the first clause of the summary. axe appends per-element colour
       values after it, which would otherwise make every instance look distinct
       and defeat the grouping entirely. */
    const reason = (f.summary || "").split(/[.(]/)[0].trim().slice(0, 80);
    const k = f.kind + "|" + f.rule + "|" + reason;
    if (!groups.has(k))
      groups.set(k, { kind: f.kind, rule: f.rule, impact: f.impact, reason, items: [] });
    groups.get(k).items.push(f);
  }

  const out = [];
  for (const g of groups.values()) {
    if (g.items.length < threshold) out.push(...g.items.map(f => ({ single: f })));
    else out.push({ group: g, count: g.items.length, examples: g.items.slice(0, examples) });
  }
  return out;
}

module.exports = { groupFindings };
