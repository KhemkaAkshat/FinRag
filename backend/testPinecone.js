import "dotenv/config";

import {
  generateAnswer,
} from "./services/chatService.js";

async function main() {
  const question =
    "What products does Apple sell?";

  console.log("\n==============================");
  console.log("FINRAG TEST");
  console.log("==============================");

  console.log("\nQuestion:");
  console.log(question);

  const result =
    await generateAnswer(question);

  console.log("\n==============================");
  console.log("ANSWER");
  console.log("==============================");

  console.log(result.answer);

  console.log("\n==============================");
  console.log("SOURCES");
  console.log("==============================");

  result.sources.forEach(
    (source, index) => {
      console.log(
        `\n${index + 1}. ${source.id}`
      );

      console.log(
        "Score:",
        source.score
      );

      console.log(
        "Section:",
        source.section
      );

      console.log(
        "Source:",
        source.sourceUrl
      );
    }
  );
}

main().catch((error) => {
  console.error(
    "\nRAG test failed:"
  );

  console.error(error);
});