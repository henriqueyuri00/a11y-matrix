# How much does a single-state accessibility run miss?

Automated accessibility checks load the page once, in whatever state the headless browser boots in:
light colour scheme, no motion preference, forced colors off, desktop viewport. That is one user, and
not an especially common one.

This measures what that costs, across 36 public homepages.

**Everything needed to reproduce it is in this directory.** `sites.json` is the sample, `scan.js`
produces `results.json`, `control.js` produces `control.json`, and `report.js` prints every figure
quoted anywhere else. No number in the write-up comes from anywhere but that script.

```bash
node study/scan.js      # the matrix, one run per state per site
node study/control.js   # the noise floor
node study/report.js    # the numbers
```

## Result

70 homepages attempted. 68 loaded; **Allegro** and **Air France** did not and are excluded rather
than counted as clean. Of the 68, **62 produced byte-identical output across two identical runs** and
only those 62 are used below.

| | |
|---|---:|
| Had at least one finding the baseline run did not surface | **42 / 62 — 68%** |
| Had at least one such finding axe classes as a **violation**, not "needs review" | **26 / 62 — 42%** |
| Distinct findings missed by the baseline | **348** |
| Median per site | **1** |

**The median is the honest headline, not the 348.** The distribution is badly skewed: half the sites
have one or none, and a handful carry most of the volume — Vercel (72), Tailwind CSS (52), Radix UI
(40), Wikipedia (31). Quoting the total alone would imply every site is sitting on dozens.

The first pass of this study covered 36 mostly-technical sites and returned 71% / 47%. Extending it
to 70 sites across regulated sectors moved those to 68% / 42%. **The finding replicated on a nearly
doubled and much more varied sample**, which is more interesting than either number on its own.

### What exposed the finding

| Variable | Sites | Distinct findings |
|---|---:|---:|
| Narrow viewport (mobile / 320px reflow) | 42 | 340 |
| Dark colour scheme | 38 | 303 |
| **Dark scheme alone** — not exposed by any narrow state | **9** | **28** |
| Reduced motion | 3 | 8 |
| Forced colors | 0 | 0 |

The first two overlap heavily, which is why *dark scheme alone* is broken out: on those 9 sites the
colour scheme is the only variable that can explain the finding. Forced colors found nothing on any
stable site — worth reporting precisely because it is a negative result.

### By sector

| Sector | Affected | Median findings |
|---|---:|---:|
| Framework and tool docs | 13 / 16 (81%) | 3 |
| Design systems | 3 / 4 (75%) | 4 |
| EU passenger transport | 3 / 4 (75%) | 3 |
| EU banking | 3 / 4 (75%) | 1 |
| EU public sector | 8 / 12 (67%) | 1 |
| Developer platforms | 4 / 7 (57%) | 1 |
| EU e-commerce | 4 / 8 (50%) | 0.5 |
| Standards bodies | 2 / 4 (50%) | 1 |

The sectors carrying an explicit legal accessibility duty are not visibly better than the ones that
do not. They are also not visibly worse.

### Which rules

`color-contrast` on 32 sites, then `page-horizontal-overflow` (9 — a document genuinely wider than a
320px viewport, the WCAG 1.4.10 condition stated directly rather than inferred),
`scrollable-region-focusable` (4), `link-in-text-block` (4), `button-name` (3).

### Clean in all seven states

**W3C, WebAIM, MDN, Playwright, Primer, GOV.UK, Service-Public (FR), Rijksoverheid (NL), Suomi.fi
(FI), Fnac, SNCF Connect.** Eleven of sixty-two. Several either write the standard, teach it, or are
bound by a public-sector accessibility duty and appear to be meeting it.

### The noise floor

Two identical runs of the same state, across all 68 sites, produced **146 findings that appeared and
156 that disappeared** — concentrated on six sites, all excluded above. The other 62 were
byte-identical.

That control is not a formality. One shopping site produced **715 apparent findings** and a churn of
+122/−125 between two identical loads: a rotating product carousel, not a defect. It was excluded,
and doing so moved its whole sector's total from 729 findings to 14. Without the control, that one
number would have been the loudest thing in this study and it would have been wrong.

## Method

Each site is loaded seven times. One run is the **baseline** — light, desktop, no preferences, which
is what an ordinary pipeline tests. The other six each change **exactly one** variable away from it
(the seventh combines dark and mobile, and is treated as ambiguous throughout for that reason).

A finding is counted when it exists in a non-baseline state and **not** in the baseline. Those are,
by construction, the findings a single-run pipeline cannot see no matter how green it is.

Scanning is read-only: one set of page loads per site, unauthenticated, homepage only. No crawling.

## The control, and why the study needs one

Real sites carry carousels, rotating promotions, A/B tests and lazily-loaded media. Two identical
loads of the same page do not necessarily produce identical output. Without measuring that, a
finding "unique to dark mode" might just be a different hero image.

`control.js` runs the **same state twice**, changing nothing between the runs. Anything reported as
new there is churn. Sites that are not byte-stable are named in the output and excluded from the
conservative headline rather than quietly kept in the denominator.

## Counting rules

These exist because the obvious way to count is wrong, and I got it wrong first.

**Findings are deduplicated across states.** A defect caused by a narrow layout appears in `mobile`,
`reflow-320` *and* `dark-mobile`. Summing the per-state counts reports one element three times. The
first version of this study did exactly that and turned ~70 findings on one site into "210". Every
figure here keys findings by `(kind, rule, element)` and counts the distinct set.

**Violations and `incomplete` are never added together.** axe reports what it can prove as a
violation and hands the rest to a human as `incomplete`. They are different claims, so they are
reported in separate columns everywhere. (This distinction is not cosmetic: text at exactly 1:1
against its own background — invisible — is reported as `incomplete`, because axe cannot prove the
element was not deliberately hidden.)

**Attribution is by group, not by single state.** Narrow-viewport states overlap by construction, so
naming one of the three as "the" cause would be arbitrary. Findings exposed by a dark state and by
no narrow state are reported separately as *dark scheme alone*, since there the colour scheme is the
only variable that can explain them.

**Sites that failed to load are reported, never folded into a denominator.**

## Why the sample includes regulated sectors

The first pass covered standards bodies, framework docs, design systems and platforms — places where
the people running the site are usually the people who read the WCAG spec. That answers whether the
gap is technically real. It does not answer whether it matters.

So the sample was extended to sectors that carry an explicit legal accessibility obligation in the
EU:

- **Public sector** — bound by the Web Accessibility Directive (EU) 2016/2102, which requires
  conformance with EN 301 549 and a published accessibility statement.
- **E-commerce, banking and passenger transport** — in scope of the European Accessibility Act,
  applicable since **28 June 2025** to services offered to consumers, with a microenterprise
  exemption (fewer than 10 staff *and* under €2m turnover).

This changes what the number means, and it needs stating carefully:

**A finding here is not a finding of non-compliance.** Conformance is assessed across a whole
service against 50-odd success criteria, most of which no scanner can evaluate; this looks at one
page, with one engine, and reports differences between rendering states. Nothing here establishes
that any organisation is in breach of anything, and it is not offered as evidence in that direction.

What it does show is narrower and still worth knowing: **the states where these defects hide are the
states an automated pipeline does not render.** An organisation that has a legal obligation, runs
automated checks, and sees them pass green may be relying on a test that never opened dark mode or
the 320px width the standard itself names.

## What this is not

- **Not an audit.** axe detects a minority of WCAG failures. Deque's own study puts axe-core at
  [57% by issue volume](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/);
  by success criteria it is roughly a third. Every number here is a lower bound on a subset.
- **Not a claim that any site is inaccessible.** A finding is a finding, not a failure, and an
  `incomplete` result is explicitly a request for human review.
- **Not a ranking.** The point is that the gap is structural — it is a property of how pipelines are
  configured, not of how much any particular team cares. Sites that came out clean in all seven
  states are named too.

Raw per-site data is committed so anyone can disagree with the interpretation without re-running
anything.
