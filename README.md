# FinRAG

## Configuration

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env.local`. The backend requires the existing Gemini and Pinecone settings. Set `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to enable authentication; without them, local development keeps the existing open chat behavior.

Redis is optional. Set `REDIS_URL` in the backend deployment to enable shared response caching and rate limiting. If Redis cannot connect or later becomes unavailable, requests continue using the in-memory fallback.

For Clerk setup, create a Clerk application, copy the publishable key to the frontend and secret key to the backend only, and add the deployed frontend URL to Clerk's allowed origins/redirect URLs. Set `FRONTEND_URL`/`FRONTEND_ORIGINS` to the deployed frontend URL and `NEXT_PUBLIC_API_BASE_URL` to the deployed backend URL.

Run `npm test` in `backend`, then `npm run build` in `frontend`.
