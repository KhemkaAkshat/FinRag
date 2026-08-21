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
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();
}
export function extractSections(text) {
  const item1Matches = [
    ...text.matchAll(/Item\s+1\.\s*Business/gi)
  ];

  if (item1Matches.length < 2) {
    throw new Error("Could not find actual Item 1 Business section.");
  }

  // First occurrence = Table of Contents
  // Second occurrence = actual filing
  const actualStart = item1Matches[1].index;

  const filingText = text.slice(actualStart);

  // Find all actual Item headings
  const headingPattern =
    /Item\s+(\d+[A-Z]?)\.\s*/gi;

  const matches = [
    ...filingText.matchAll(headingPattern)
  ];

  const sections = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];

    const item = match[1];

    const headingStart = match.index;

    const contentStart =
      headingStart + match[0].length;

    const contentEnd =
      i + 1 < matches.length
        ? matches[i + 1].index
        : filingText.length;

    const fullSection = filingText
      .slice(headingStart, contentEnd)
      .trim();

    // Extract title from the beginning of the section.
    // Title ends when the actual content begins.
    const titleMatch = fullSection.match(
      new RegExp(
        `^Item\\\\s+${item}\\\\.\\\\s*([^.!?\\d]{3,150})`
      )
    );

    const title = titleMatch
      ? titleMatch[1].trim()
      : `Item ${item}`;

    const textStart = titleMatch
      ? titleMatch[0].length
      : match[0].length;

    const sectionText = fullSection
      .slice(textStart)
      .trim();

    sections.push({
      item,
      title,
      text: sectionText
    });
  }

  return sections;
}
