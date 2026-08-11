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

Of 36 homepages, all of which scanned successfully:

| | |
|---|---:|
| Produced output identical across two identical runs (the control) | **34 / 36** |
| Of those, had at least one finding the baseline run did not surface | **24 / 34 — 71%** |
| Had at least one such finding axe classes as a **violation**, not "needs review" | **16 / 34 — 47%** |
| Distinct findings missed by the baseline, across the stable sites | **296** |
| Median per site | **2** |

**The distribution is very skewed, and the median is the honest number.** Half the sites have two or
fewer. Seven sites carry most of the volume — Vercel (72), Tailwind CSS (52), Radix UI (40),
Wikipedia (31), TypeScript (17), Stripe (17), NASA (14). Quoting the 296 without the median would
imply every site is sitting on dozens, and that is not what the data says.

### What exposed the finding

| Variable | Sites | Distinct findings |
|---|---:|---:|
| Narrow viewport (mobile / 320px reflow) | 26 | 301 |
| Dark colour scheme | 25 | 270 |
| **Dark scheme alone** — not exposed by any narrow state | **9** | **31** |
| Reduced motion | 4 | 10 |
| Forced colors | 1 | 2 |

The first two overlap heavily, which is why *dark scheme alone* is broken out: on those 9 sites the
colour scheme is the only variable that can explain the finding.

### Which rules

`color-contrast` on 22 sites, then `scrollable-region-focusable` (4), `link-in-text-block` (4),
`button-name` (4), and `page-horizontal-overflow` (3 — a document genuinely wider than a 320px
viewport, which is the WCAG 1.4.10 condition stated directly rather than inferred).

### Clean in all seven states

**W3C, WebAIM, MDN, Playwright, Primer, GOV.UK.** Six of thirty-six. It is worth noticing that four
of them either write the standard, teach it, or are bound by a public-sector accessibility duty.

### The noise floor

Two identical runs of the same state, across all 36 sites, produced **7 findings that appeared and 2
that disappeared** — all of them on two sites (Carbon, NASA), which are excluded from the figures
above. The other 34 were byte-identical. The signal clears the noise by roughly forty to one.

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
