# a11y-matrix

[![test](https://github.com/henriqueyuri00/a11y-matrix/actions/workflows/test.yml/badge.svg)](https://github.com/henriqueyuri00/a11y-matrix/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Your accessibility check tests one user. Real users arrive with preferences already set.**

`a11y-matrix` runs axe-core across the browser states a normal pipeline never enters — dark mode,
reduced motion, forced colors, mobile, and the 320px reflow width — and reports the findings that
exist in one state and **not** in your baseline. Those are, by construction, the defects a green CI
run structurally cannot see.

```bash
npx github:henriqueyuri00/a11y-matrix https://example.com
```

---

## The two-line version of why this exists

I shipped a button whose label was invisible in dark mode. Same colour as its own background —
1:1 contrast, no text visible at all. My CI was green the whole time.

It was green for two separate reasons, and the second one surprised me:

1. **The headless browser boots in light mode.** axe evaluates the colour scheme that is actually
   rendered. Nobody had rendered the dark one.
2. **Even when you do render dark mode, axe files this under `incomplete`, not `violations`.**
   Text at exactly 1:1 could be a deliberate hiding technique, so axe declines to call it a failure
   and asks a human. Almost every pipeline asserts on `violations` and drops `incomplete` on the
   floor. The most severe contrast defect there is lands in the bucket everyone discards.

`a11y-matrix` collects both buckets and keeps them distinct.

## What it looks like

```
Baseline (baseline)
  nothing — this is what your current pipeline sees

Dark mode (dark)  1 needing review not present in baseline
  prefers-color-scheme: dark. Dark palettes are usually authored by hand after the light one has
  already been reviewed, so contrast regressions land here and are never seen again.
    review    color-contrast  button
              Element has a 1:1 contrast ratio with the background

1 finding is invisible to a single-run pipeline.
```

## Does this actually find anything?

I pointed it at 70 public homepages — standards bodies, framework docs, design systems, GitHub,
Wikipedia, and sectors with an explicit EU legal accessibility duty: public sector, banking,
passenger transport and e-commerce.

**42 of 62 stable sites (68%) had at least one finding the baseline never surfaced. 26 of 62 (42%)
had a violation, not merely something needing review.** Median one per site; the distribution is
skewed and a handful of sites carry most of the volume. Eleven were clean in all seven states,
including W3C, MDN, GOV.UK and three EU government portals.

Six sites were excluded because two *identical* runs of the same state disagreed — rotating
carousels, not defects. One of them alone accounted for 715 apparent findings. Excluding it moved
its sector's total from 729 to 14, which is why the control run exists.

[**Full method, counting rules, caveats and raw data →**](study/) Everything is committed, including
the control run, so you can disagree with the interpretation without re-running anything.

## The states

Each state changes exactly **one** variable away from the baseline. A full cross-product would be
64 runs and would tell you the page is broken without telling you which preference broke it.
Single-factor deltas name the cause, and the cause is the bug report.

| State | What it changes | Why it finds things |
|---|---|---|
| `baseline` | — | Light, desktop, no preferences. The only state most pipelines test. |
| `dark` | `prefers-color-scheme: dark` | Dark palettes are authored after the light one is signed off. |
| `reduced-motion` | `prefers-reduced-motion: reduce` | Content that only appears at the end of an animation you were asked not to play. |
| `forced-colors` | `forced-colors: active` | Windows High Contrast replaces your palette; meaning carried by shadows and borders vanishes. |
| `mobile` | 390×844 | Re-stacked text lands on new backgrounds; hit targets fall under 24×24 (WCAG 2.5.8). |
| `reflow-320` | 320×1024 | The width **WCAG 1.4.10 normatively requires**. Almost nothing tests it automatically. |
| `dark-mobile` | dark + 390×844 | The one pairing worth an extra run — usually built by different people, opened by neither. |

`forced-colors` deliberately drops contrast findings: in that mode the OS palette is not yours, so
reporting a contrast result there would be measuring the wrong thing.

## Two things it refuses to get wrong

**Reflow is measured, not inferred.** axe has no rule for WCAG 1.4.10. What you get instead is a
contrast rule complaining that an element is "partially obscured", which is a side effect and not
the requirement. `a11y-matrix` asks the document directly whether it is wider than its own viewport
and reports `page-horizontal-overflow` with the actual pixel figure. That is the 1.4.10 condition,
stated plainly.

**Fixing it correctly is not punished.** axe emits the *same* "partially obscured" message for an
element covered by an overlay (a real defect) and for a table cell scrolled out of view inside an
overflow container (the sanctioned way to present a wide data table at 320px). This tool walks the
DOM and asks whether the element sits inside an ancestor that genuinely scrolls horizontally and
that a keyboard can reach. If so the finding is suppressed — and the count and reason are printed,
never dropped silently, so you can audit the decision.

That second one was found by scanning my own sales page, correcting it the recommended way, and
watching the tool keep failing the corrected version.

## Scanning a whole site

One page is a demo. Pass several, a file of URLs, or a sitemap:

```bash
npx github:henriqueyuri00/a11y-matrix --sitemap https://example.com/sitemap.xml
npx github:henriqueyuri00/a11y-matrix https://example.com/ https://example.com/pricing
npx github:henriqueyuri00/a11y-matrix --urls pages.txt --max-pages 50
```

Across pages, findings are **deduplicated by element**, and the page count becomes the headline
instead of the volume:

```
every page (shared layout — fixing this once fixes it everywhere)
  serious   color-contrast  .nav-cta
            18 page(s) · exposed by: dark, dark-mobile

one page (specific to a single page)
  serious   button-name     #filter-toggle
            1 page(s) · exposed by: mobile, reflow-320
```

A header defect on 18 pages is one problem in one component, not 18 problems. Reporting it 18 times
buries the handful that are genuinely page-specific — and tells the team the wrong thing about how
much work they have.

`--max-pages` defaults to 25, and truncation is always printed. A tool that silently scans 25 of
4000 pages and reports "nothing found" has told you something false.

## Usage

```bash
npx github:henriqueyuri00/a11y-matrix <url|file> [more urls...] [options]

  --sitemap <url>    take pages from a sitemap.xml (follows an index one level)
  --urls <file>      one URL or path per line; '#' comments allowed
  --max-pages <n>    cap on pages scanned, always announced  (default: 25)
  --states <a,b>     only these states (baseline is always included)
  --tags <a,b>       axe tag filter    (default: wcag2a,wcag2aa,wcag21a,wcag21aa)
  --json <file>      full result as JSON
  --markdown <file>  a PR-comment-shaped summary
  --fail-on <mode>   unique | any | never   (default: unique)
  --settle <ms>      wait after load before scanning (default: 400)
  --list-states      print the matrix and exit
```

Exit code is `1` when something fails the `--fail-on` mode, `2` on a usage or navigation error.
The default, `unique`, fails only on findings that are **new relative to your baseline** — so
adopting this does not dump your existing backlog into a red build on day one.

### In GitHub Actions

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 20 }
- run: npx playwright install --with-deps chromium
- run: npx github:henriqueyuri00/a11y-matrix https://staging.example.com --markdown report.md
```

## Scope, honestly

This finds a specific and under-tested class of defect. It is not an audit and it does not replace
manual testing.

Two numbers get quoted about automated coverage and they measure different things. By **issue
volume**, Deque's study of ~300,000 findings puts axe-core at
[57%](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/) —
high because cheap-to-detect failures like contrast are also the most frequent. By **success
criteria**, only about a third of the WCAG 2.1 AA criteria can be meaningfully automated at all.
Both are true. Neither gets you to conformance without a person.

What this closes is a narrower gap, but a wide-open one: the states your users have already set and
your CI has never entered.

If you need to write down where you stand against all 50 WCAG 2.1 A/AA criteria, the
[ACR Builder](https://henriqueyuri00.github.io/acr-builder/) is free and MIT-licensed too.

## Development

```bash
npm install
npx playwright install chromium
npm test        # 28 checks: unit, plus three fixtures that must be attributed correctly
```

The test suite is built to falsify the product's claim rather than confirm it. A page that is
genuinely fine must stay silent across all seven states — a tool that cries wolf gets switched off
within a week — and a page broken in exactly one state must be blamed on that state and no other.

## Licence

MIT.
