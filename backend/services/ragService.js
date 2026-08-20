import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-001",
  apiKey: process.env.GEMINI_API_KEY
});

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1200,
  chunkOverlap: 200
});

export async function createRagDocuments(
  sections,
  metadata
) {
  const documents = [];

  for (const section of sections) {
    const sectionDocuments =
      await splitter.createDocuments(
        [section.text],
        [
          {
            ...metadata,
            item: section.item,
            section:
              section.title ||
              `Item ${section.item}`
          }
        ]
      );

    documents.push(...sectionDocuments);
  }

  return documents;
}

export async function embedDocument(document) {
  const vector =
    await embeddings.embedQuery(
      document.pageContent
    );

  return vector;
}