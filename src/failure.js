/*
 * What is allowed to break a build.
 *
 * The default is new VIOLATIONS only, and that is a deliberate retreat from
 * where this tool started.
 *
 * axe reports "incomplete" precisely when it cannot decide and wants a human.
 * One perfectly reasonable data table produces hundreds of them, because
 * "content is too short to determine if it is actual text content" fires on
 * every numeric cell — this project's own results page generates 478 across
 * seven states, with zero violations among them. Failing a build on "a person
 * should look at this" is how a check gets deleted from the pipeline in its
 * first week, and a deleted check finds nothing at all.
 *
 * So incomplete results are surfaced loudly and cost nothing. Teams that want
 * them enforced can ask for it with --fail-on findings.
 */
const FAIL_MODES = ["violations", "findings", "any", "never"];

function shouldFail(mode, { newViolations = 0, newFindings = 0, everything = 0 } = {}) {
  switch (mode) {
    case "never":    return false;
    case "any":      return everything > 0;
    case "findings": return newFindings > 0;
    /* Anything unrecognised falls through to the default rather than to
       passing: a typo in a CI config must not silently disable the check. */
    default:         return newViolations > 0;
  }
}

module.exports = { FAIL_MODES, shouldFail };
