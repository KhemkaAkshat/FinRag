import { createApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();
const app = createApp({ allowedOrigins: config.allowedOrigins });

app.listen(config.port, () => {
  console.log(`FinRAG backend running on port ${config.port}`);
});
