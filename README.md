# FinRAG

## Configuration

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env.local`. The backend requires the existing Gemini and Pinecone settings. Set `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to enable authentication; without them, local development keeps the existing open chat behavior.

Redis is optional. Set `REDIS_URL` in the backend deployment to enable shared response caching and rate limiting. If Redis cannot connect or later becomes unavailable, requests continue using the in-memory fallback.

For Clerk setup, create a Clerk application, copy the publishable key to the frontend and secret key to the backend only, and add the deployed frontend URL to Clerk's allowed origins/redirect URLs. Set `FRONTEND_URL`/`FRONTEND_ORIGINS` to the deployed frontend URL and `NEXT_PUBLIC_API_BASE_URL` to the deployed backend URL.

Run `npm test` in `backend`, then `npm run build` in `frontend`.

## Multi-company ingestion

Company discovery uses the SEC company/ticker/CIK directory dynamically. Chat never ingests or embeds an unindexed company. To explicitly ingest the latest 10-K and 10-Q for a company, run from `backend`:

```bash
npm run ingest:company -- AAPL
npm run ingest:company -- "Microsoft Corporation" --forms=10-K,10-Q
```

Ingestion stages SEC filings and checkpoint state under `INGESTION_STAGING_PATH` and `INGESTION_STATE_PATH`. The state and staging paths must be persistent in deployment so a Gemini or Pinecone failure can resume safely. New vectors use deterministic CIK/accession/chunk IDs, and BM25 updates are atomic and additive to the existing Apple corpus.

On-demand indexing from the chat UI requires an authenticated Clerk user whose ID is listed in `CLERK_INGESTION_ADMIN_USER_IDS` (comma-separated). The UI polls the company status endpoint while the queue processes the latest filings and enables normal chat after the status becomes `READY`.
