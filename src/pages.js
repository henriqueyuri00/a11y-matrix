/*
 * Resolving what to scan.
 *
 * A tool that only ever checks one URL is a demo. Teams have a site, so the
 * realistic entry points are "these pages", "this file of pages", or "whatever
 * is in the sitemap".
 */
const fs = require("fs");
const path = require("path");

/* A bare path is far more common than a file:// URL on the command line, and
   getting it wrong yields an opaque navigation error, so resolve it here. */
function toUrl(target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error("no such file: " + abs);
  return "file:///" + abs.replace(/\\/g, "/");
}

function fromFile(file) {
  if (!fs.existsSync(file)) throw new Error("no such file: " + file);
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map(l => l.trim())
    /* '#' starts a comment so a URL list can carry notes, which is what people
       actually do with these files. */
    .filter(l => l && !l.startsWith("#"));
}

/*
 * Sitemaps are parsed with a regex rather than an XML library, on purpose: the
 * only thing needed is the <loc> values, and pulling in a parser for that is a
 * dependency the tool would carry forever. Sitemap indexes are followed one
 * level, which covers essentially every real site.
 */
async function fromSitemap(url, { maxPages, depth = 0 }) {
  const res = await fetch(url, { headers: { "user-agent": "a11y-matrix" } });
  if (!res.ok) throw new Error(`sitemap ${url} returned ${res.status}`);
  const xml = await res.text();

  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
  if (!locs.length) throw new Error(`no <loc> entries found in ${url}`);

  const isIndex = /<sitemapindex/i.test(xml);
  if (!isIndex) return locs;
  if (depth > 0) return locs;   // one level is enough; deeper is a crawler, not this

  const out = [];
  for (const child of locs) {
    if (out.length >= maxPages) break;
    try {
      out.push(...await fromSitemap(child, { maxPages, depth: depth + 1 }));
    } catch (e) {
      process.stderr.write(`  skipped sitemap ${child}: ${e.message}\n`);
    }
  }
  return out;
}

/*
 * Truncation is always announced. A tool that silently scans the first 50 of
 * 4000 pages and prints "no issues" has told the reader something false.
 */
function capped(urls, maxPages, onTruncate) {
  const seen = new Set();
  const unique = urls.filter(u => !seen.has(u) && seen.add(u));
  if (unique.length > maxPages) {
    onTruncate(unique.length, maxPages);
    return unique.slice(0, maxPages);
  }
  return unique;
}

async function resolvePages(opts, onTruncate) {
  let urls = [];
  if (opts.sitemap) urls.push(...await fromSitemap(opts.sitemap, { maxPages: opts.maxPages }));
  if (opts.urlsFile) urls.push(...fromFile(opts.urlsFile));
  urls.push(...opts.urls);
  if (!urls.length) throw new Error("no pages to scan");
  return capped(urls.map(toUrl), opts.maxPages, onTruncate);
}

module.exports = { resolvePages, toUrl, fromFile, fromSitemap };
