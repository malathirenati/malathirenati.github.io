// Eleventy config. Deliberately minimal — the site is plain HTML/CSS/JS once built.
//
// PATH_PREFIX lets the same build work both at a domain root — which is what a
// user site (user.github.io) and a custom domain both give you — and under a
// project subpath (user.github.io/repo/). Every internal link in the templates
// goes through the `url` filter, which applies this prefix.

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/static": "." });

  // Watch the generated data so `npm run serve` reloads when a sheet is rebuilt.
  eleventyConfig.addWatchTarget("src/_data/");

  // Embed a data file into the page as JSON. Escapes `<` so a stray "</script>"
  // inside spreadsheet text can never break out of the script tag.
  eleventyConfig.addFilter("jsonScript", (value) =>
    JSON.stringify(value).replace(/</g, "\\u003c")
  );

  eleventyConfig.addFilter("year", () => new Date().getFullYear());

  // Nunjucks' built-in `slice` chunks arrays — it does not slice strings — so
  // dates need their own filters. `isoDate` feeds <time datetime>, `humanDate`
  // is what the reader sees. UTC throughout, so the date never shifts by zone.
  eleventyConfig.addFilter("isoDate", (value) => (value ? String(value).slice(0, 10) : ""));

  /* Astronomical year -> reader-facing label. Must match formatYear() in
     scripts/lib/parse.mjs and in the two front-end scripts, or a page can print
     "-2599" where the chart beside it says "2600 BC". */
  eleventyConfig.addFilter("formatYear", (value) => {
    const y = Math.round(Number(value));
    if (!Number.isFinite(y)) return "";
    if (y <= 0) return `${1 - y} BC`;
    if (y < 1000) return `AD ${y}`;
    return String(y);
  });

  eleventyConfig.addFilter("humanDate", (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    pathPrefix: process.env.PATH_PREFIX || "/",
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
