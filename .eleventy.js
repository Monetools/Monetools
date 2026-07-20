module.exports = function(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("admin");
  eleventyConfig.addPassthroughCopy("config");
  eleventyConfig.addPassthroughCopy("tools");
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("index.html");
  eleventyConfig.addPassthroughCopy("affiliate-config.js");
  eleventyConfig.addPassthroughCopy("about.html");
  eleventyConfig.addPassthroughCopy("contact.html");
  eleventyConfig.addPassthroughCopy("privacy-policy.html");
  eleventyConfig.addPassthroughCopy("manifest.json");

  eleventyConfig.addFilter("readableDate", (dateObj) => {
    if (!dateObj) return "";
    const d = new Date(dateObj);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  // Used only by sitemap.xml — outputs YYYY-MM-DD, the format the
  // sitemap protocol requires for <lastmod> (not the human-readable version).
  eleventyConfig.addFilter("isoDate", (dateObj) => {
    if (!dateObj) return "";
    const d = new Date(dateObj);
    return d.toISOString().split("T")[0];
  });

  return {
    dir: {
      input: "content",
      includes: "../_includes",
      output: "_site"
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
};
