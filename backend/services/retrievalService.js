const DEFAULT_RRF_K = 60;

export function buildMetadataFilter(filters = {}) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

export function matchesMetadata(metadata = {}, filters = {}) {
  return Object.entries(buildMetadataFilter(filters)).every(
    ([key, value]) => String(metadata[key] ?? "") === String(value),
  );
}

function mergeDocument(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    metadata: { ...(existing?.metadata || {}), ...(incoming?.metadata || {}) },
    text: existing?.text || incoming?.text || incoming?.metadata?.text || existing?.metadata?.text,
  };
}

export function reciprocalRankFusion(vectorResults = [], bm25Results = [], topK = 5, k = DEFAULT_RRF_K) {
  const merged = new Map();

  vectorResults.forEach((result, index) => {
    const id = result.id;
    if (!id) return;
    const document = {
      id,
      metadata: result.metadata || {},
      text: result.text ?? result.metadata?.text,
      vectorScore: result.vectorScore ?? result.score,
    };
    const current = merged.get(id) || { document: {}, rrfScore: 0 };
    merged.set(id, {
      document: mergeDocument(current.document, document),
      rrfScore: current.rrfScore + 1 / (k + index + 1),
    });
  });

  bm25Results.forEach((result, index) => {
    const id = result.id;
    if (!id) return;
    const document = {
      id,
      metadata: result.metadata || {},
      text: result.text ?? result.metadata?.text,
      bm25Score: result.bm25Score ?? result.score,
    };
    const current = merged.get(id) || { document: {}, rrfScore: 0 };
    merged.set(id, {
      document: mergeDocument(current.document, document),
      rrfScore: current.rrfScore + 1 / (k + index + 1),
    });
  });

  return [...merged.entries()]
    .sort((a, b) => b[1].rrfScore - a[1].rrfScore || a[0].localeCompare(b[0]))
    .slice(0, topK)
    .map(([, value]) => ({ ...value.document, rrfScore: value.rrfScore }));
}

