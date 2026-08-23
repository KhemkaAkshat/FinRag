import { ingestCompany } from "./services/ingestionService.js";

const [searchTerm, ...args] = process.argv.slice(2);
const formsArg = args.find((arg) => arg.startsWith("--forms="))?.split("=")[1];
const forms = formsArg ? formsArg.split(",").map((form) => form.trim().toUpperCase()).filter((form) => ["10-K", "10-Q"].includes(form)) : ["10-K", "10-Q"];

if (!searchTerm) {
  console.error("Usage: npm run ingest:company -- <ticker-or-company> [--forms=10-K,10-Q]");
  process.exit(1);
}

ingestCompany({ searchTerm, forms }).then((result) => {
  console.log(`Ingestion complete for ${result.company.name} (${result.company.ticker}).`);
}).catch((error) => {
  console.error(`Ingestion failed: ${error.message}`);
  process.exitCode = 1;
});
