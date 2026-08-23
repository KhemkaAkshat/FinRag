export function stableDocumentId({ cik, accessionNumber, chunkIndex }) {
  const normalizedCik = String(cik || "unknown").replace(/\D/g, "").padStart(10, "0");
  const accession = String(accessionNumber || "unknown").replace(/[^a-zA-Z0-9]/g, "");
  return `finrag-${normalizedCik}-${accession}-${String(chunkIndex).padStart(5, "0")}`;
}

export function filingKey(filing) {
  return `${filing.form}:${filing.accessionNumber}`;
}
