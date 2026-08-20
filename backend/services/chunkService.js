export function chunkText(text, options = {}) {
  const {
    chunkSize = 1200,
    chunkOverlap = 200
  } = options;

  text = text
    .replace(/\s+/g, " ")
    .trim();

  const chunks = [];

  let start = 0;

  while (start < text.length) {
    let end = Math.min(
      start + chunkSize,
      text.length
    );

    // Try to end at a sentence boundary
    if (end < text.length) {
      const sentenceEnd = text.lastIndexOf(".", end);

      if (sentenceEnd > start + chunkSize * 0.5) {
        end = sentenceEnd + 1;
      }
    }

    const chunk = text
      .slice(start, end)
      .trim();

    if (chunk) {
      chunks.push(chunk);
    }

    // Stop if we've reached the end
    if (end >= text.length) {
      break;
    }

    // Move forward while keeping overlap
    start = end - chunkOverlap;
  }

  return chunks;
}

export function chunkSections(sections, metadata) {
  const allChunks = [];

  for (const section of sections) {
    const chunks = chunkText(section.text);

    chunks.forEach((text, index) => {
      allChunks.push({
        id: `${metadata.ticker}-${metadata.filingType}-${section.item}-${index + 1}`,

        text,

        metadata: {
          ...metadata,

          item: section.item,
          section: section.title || `Item ${section.item}`,

          chunkIndex: index,
          totalChunksInSection: chunks.length
        }
      });
    });
  }

  return allChunks;
}