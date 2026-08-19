import * as cheerio from "cheerio";

export function extractTextFromHtml(html) {
  const $ = cheerio.load(html);

  // Remove elements that aren't part of the readable filing
  $("script").remove();
  $("style").remove();
  $("noscript").remove();

  // Remove XBRL-related elements
  $("ix\\:header").remove();
  $("ix\\:hidden").remove();
  $("ix\\:resources").remove();

  const text = $("body").text();

  return text
    .replace(/\s+/g, " ")
    .trim();
}
export function extractSections(text) {
  const item1Matches = [
    ...text.matchAll(/Item\s+1\.\s*Business/gi)
  ];

  if (item1Matches.length < 2) {
    throw new Error("Could not find actual Item 1 Business section.");
  }

  const actualStart = item1Matches[1].index;

  const filingText = text.slice(actualStart);

  const sectionPattern =
    /Item\s+(\d+[A-Z]?)\.\s*([A-Za-z][A-Za-z0-9’'&,\-\[\](). ]{2,150}?)(?=Item\s+\d+[A-Z]?\.)/gi;

  const matches = [
    ...filingText.matchAll(sectionPattern)
  ];

  const sections = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];

    const item = match[1];
    const title = match[2].trim();

    const contentStart = match.index + match[0].length;

    const contentEnd =
      i + 1 < matches.length
        ? matches[i + 1].index
        : filingText.length;

    const text = filingText
      .slice(contentStart, contentEnd)
      .trim();

    sections.push({
      item,
      title,
      text
    });
  }

  return sections;
}