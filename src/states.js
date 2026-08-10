/*
 * The state matrix.
 *
 * A normal accessibility CI run loads the page once, in whatever state the
 * headless browser happens to boot in: light scheme, no motion preference,
 * forced colors off, desktop viewport. That is one user. It is not a
 * particularly common user, and it is never the user who is most likely to
 * be excluded by a defect.
 *
 * Each state below changes exactly ONE variable away from the baseline. That
 * is deliberate: a full cross-product of six variables is 2^6 runs and, worse,
 * tells you a page is broken without telling you which preference broke it.
 * Single-factor deltas are slower to be exhaustive but they name the cause,
 * and naming the cause is the whole point — "3 violations" is a chore,
 * "these 3 violations appear only in dark mode" is a bug report.
 */

const BASELINE_VIEWPORT = { width: 1280, height: 800 };

const STATES = [
  {
    id: "baseline",
    label: "Baseline",
    why: "Light scheme, desktop, no preferences set. This is the only state most CI pipelines ever test.",
    media: { colorScheme: "light", reducedMotion: "no-preference", forcedColors: "none" },
    viewport: BASELINE_VIEWPORT
  },
  {
    id: "dark",
    label: "Dark mode",
    why: "prefers-color-scheme: dark. Dark palettes are usually authored by hand after the light one " +
         "has already been reviewed, so contrast regressions land here and are never seen again.",
    media: { colorScheme: "dark", reducedMotion: "no-preference", forcedColors: "none" },
    viewport: BASELINE_VIEWPORT
  },
  {
    id: "reduced-motion",
    label: "Reduced motion",
    why: "prefers-reduced-motion: reduce. Catches content that only becomes visible at the end of an " +
         "animation the user has asked you not to play (WCAG 2.3.3, and 1.4.3 when the end state differs).",
    media: { colorScheme: "light", reducedMotion: "reduce", forcedColors: "none" },
    viewport: BASELINE_VIEWPORT
  },
  {
    id: "forced-colors",
    label: "Forced colors",
    why: "forced-colors: active — Windows High Contrast. The OS replaces your palette wholesale, so " +
         "anything that carried meaning through background-image, box-shadow or a border colour disappears.",
    media: { colorScheme: "light", reducedMotion: "no-preference", forcedColors: "active" },
    viewport: BASELINE_VIEWPORT
  },
  {
    id: "mobile",
    label: "Mobile viewport",
    why: "390x844. Layout changes at this width routinely re-stack text over new backgrounds and shrink " +
         "hit targets below the 24x24 CSS px floor of WCAG 2.5.8.",
    media: { colorScheme: "light", reducedMotion: "no-preference", forcedColors: "none" },
    viewport: { width: 390, height: 844 }
  },
  {
    id: "reflow-320",
    label: "Reflow at 320px",
    why: "320x1024 — the reflow width WCAG 1.4.10 requires, equivalent to 400% zoom on a 1280px screen. " +
         "This is a normative requirement, not a nice-to-have, and almost nothing tests it automatically.",
    media: { colorScheme: "light", reducedMotion: "no-preference", forcedColors: "none" },
    viewport: { width: 320, height: 1024 }
  },
  {
    id: "dark-mobile",
    label: "Dark + mobile",
    why: "The one combination worth spending an extra run on: dark palette and the mobile layout are " +
         "usually built by different people at different times, and the pairing is rarely opened by either.",
    media: { colorScheme: "dark", reducedMotion: "no-preference", forcedColors: "none" },
    viewport: { width: 390, height: 844 }
  }
];

const BASELINE_ID = "baseline";

/* A state is only worth running if it can differ from the baseline. Callers may
   restrict the matrix; keep the baseline regardless, since every delta is
   computed against it. */
function selectStates(ids) {
  if (!ids || !ids.length) return STATES;
  const wanted = new Set([BASELINE_ID, ...ids]);
  const unknown = ids.filter(id => !STATES.some(s => s.id === id));
  if (unknown.length) {
    throw new Error("unknown state(s): " + unknown.join(", ") +
                    "\nknown states: " + STATES.map(s => s.id).join(", "));
  }
  return STATES.filter(s => wanted.has(s.id));
}

module.exports = { STATES, BASELINE_ID, selectStates };
