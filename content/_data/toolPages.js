// content/_data/toolPages.js
// Automatically scans the /tools folder at build time and returns a clean list
// of tool page URLs, for use in sitemap.njk. Skips backup/duplicate files
// (e.g. "old", "(1)", "(2)") so stray copies never leak into the sitemap.

const fs = require("fs");
const path = require("path");

module.exports = function () {
  const toolsRoot = path.join(process.cwd(), "tools");
  const urls = [];

  if (!fs.existsSync(toolsRoot)) return urls;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.name.endsWith(".html")) continue;

      // Skip backups / duplicates / drafts:
      //   should-i-form-an-llc(old).html
      //   quarterly-tax-estimator (1).html
      //   0706index.html  (dated scratch file)
      const lower = entry.name.toLowerCase();
      if (
        lower.includes("old") ||
        /\(\d+\)/.test(lower) ||
        /^\d{4}/.test(lower)
      ) {
        continue;
      }

      // Build the public URL relative to the tools root
      const relative = path.relative(toolsRoot, fullPath).replace(/\\/g, "/");
      urls.push(`/tools/${relative}`);
    }
  }

  walk(toolsRoot);
  return urls.sort();
};
