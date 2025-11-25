# AskYC

This repository contains a two-part application that provides a chat interface powered by a language model and a knowledge retrieval system. The project is split into a backend service that handles model orchestration and retrieval, and a frontend Next.js application that provides the user interface and streams model output to the browser.

## Repository layout

- `backend/`
  - `main.py` - FastAPI application exposing a streaming endpoint at `/stream`.
  - `graph.py` - Core orchestration logic built with `langgraph` and `langchain`. Contains tools for retrieval from Supabase and the graph state logic.
  - `requirements.txt` - Python dependencies for the backend.

- `frontend/askyc/`
  - `app/` - Next.js App Router pages and API routes.
    - `api/stream/route.ts` - forwards requests from the frontend to the backend streaming endpoint.
    - `page.tsx` - the main chat UI built with components under `components/`.
  - `components/` - UI and chat related React components used by the application.
  - `package.json` - frontend dependencies and scripts.

## High level overview

1. The user interacts with the chat UI in the Next.js app.
2. The frontend sends chat messages to `POST /api/stream` in the Next app.
3. The Next API route proxies the request to the backend FastAPI streaming endpoint at `http://localhost:8000/stream`.
4. The backend builds a message sequence and runs it through a `langgraph` state graph which may call retrieval tools. Events are streamed back from the graph and forwarded to the frontend.
5. The frontend receives stream chunks, appends the text to the conversation, and extracts any structured data that is embedded in the stream (for example, data with the prefix `2: {...}` used to pass data-sources).

## Features

- Streaming chat responses from a language model.
- Retrieval tool integrated with Supabase using vector search to fetch transcript chunks.
- Langgraph based orchestration that can call tools and return tool outputs alongside the model stream.
- Frontend UI that supports model selection, streaming loader, retry/regenerate, and embedded source links.

## Prerequisites

- A Supabase instance with documents and a `match_chunks` rpc for vector search as used by the backend tool.
- OpenAI API key or compatible LLM endpoint configured in the environment.

## Required environment variables

Create a `.env` file in the `backend/` directory with at least the following variables. Do not commit `.env` to source control.

```
OPENAI_API_KEY=your_openai_api_key
SUPABASE_URL=https://your-supabase-url
SUPABASE_KEY=your-supabase-service-key
LANGFUSE_PUBLIC_KEY=your_langfuse_public_key
LANGFUSE_SECRET_KEY=your_langfuse_secret_key
```

Notes:
- The backend uses these keys to create clients for OpenAI, Supabase, and Langfuse.
- The code loads environment variables using `python-dotenv` so a local `backend/.env` file will be read automatically.

## Backend setup and run

1. Create and activate a Python virtual environment.

```bash
python -m venv .venv
source .venv/bin/activate
```

2. Install dependencies.

```bash
pip install -r backend/requirements.txt
```

3. Make sure `backend/.env` is present and populated with the required environment variables described above.

4. Run the FastAPI application with `uvicorn` from the repository root.

```bash
uvicorn backend.main:app --reload --port 8000
```

The backend exposes a streaming POST endpoint at `http://localhost:8000/stream` that accepts a message payload and returns streamed model output.

## Frontend setup and run

1. Change to the frontend directory and install packages.

```bash
cd frontend/askyc
npm install
```

2. Start the Next.js development server.

```bash
npm run dev
```

3. Open `http://localhost:3000` in your browser.

Notes about the frontend streaming flow:
- The frontend code uses `@ai-sdk/react` and the `TextStreamChatTransport` configured with `api: '/api/stream'`.
- The API route `app/api/stream/route.ts` proxies the request to `http://localhost:8000/stream`. When running locally, ensure the backend is running on port 8000.
- The UI contains logic to parse and separate embedded data chunks in the stream. The frontend looks for a numeric prefix followed by a JSON object at the end of message chunks. For example, the backend may yield a chunk like `2:{"type":"data-sources","data":{"videos":[...],"urls":[...]}}` which the frontend extracts and renders as source links.

## Data flow and important code locations

- `backend/main.py` - converts incoming JSON messages into `langchain_core` message types and forwards them to `graph.astream_events`. It interprets streaming events and yields raw text chunks as they arrive. It also batches any discovered source pairs and yields a final data-sources payload encoded as a JSON chunk with a numeric prefix so the frontend can pick it up.

- `backend/graph.py` - defines the `master` node and a tool `fetch_yc_chunks` which performs vector search against Supabase. It binds tools to a streaming chat model and controls when the graph invokes retrieval.

- `frontend/askyc/app/page.tsx` and components in `frontend/askyc/components/ai-elements/` - the main chat UI and the logic to parse and render streamed messages and extracted data parts.

- `frontend/askyc/app/api/stream/route.ts` - a thin proxy from the Next.js application to the backend streaming endpoint. This simplifies client fetches and avoids CORS complexity while developing locally.

## Development notes and tips

- Keep the backend running on port 8000. The frontend route forwards requests to `http://localhost:8000/stream`.
- The backend depends on correct Supabase configuration and a working `match_chunks` RPC for vector retrieval. If retrieval calls fail, the graph will continue but retrieved context will be empty.
- The graph node limits retrieval to at most two retrievals per user message. That logic is implemented in `graph.py` in the `master` function and the retrieval policy comment.
- The frontend sanitizes assistant text for embedded JSON data chunks. If you change the data chunk format in the backend, update the frontend parser in `app/page.tsx` accordingly.

## Deployment notes

Backend
- Containerize the backend or deploy it to a Python-friendly host. Ensure environment variables are provided as secure secrets. Expose the streaming endpoint and update the frontend proxy or CORS config as needed.

Frontend
- The Next.js app can be deployed to Vercel or any platform that supports Node and Next. Update the API route to call your deployed backend endpoint instead of `http://localhost:8000/stream`.

Security
- Do not commit `backend/.env` or any secret keys. Use service principals or role-limited keys for Supabase and limit network access to private services when possible.

## Contributing

If you plan to contribute:

1. Fork the repo and make a feature branch.
2. Keep changes small and focused.
3. If you add environment requirements document them in this README.

## Troubleshooting

- If the frontend does not show model output, confirm the backend is running and reachable at `http://localhost:8000/stream`.
- If retrieval returns no data, verify Supabase credentials and that the `match_chunks` function exists and returns expected rows.
- If the stream contains malformed JSON data chunks, check backend event handling for the final data-sources payload in `backend/main.py`.

## Acknowledgements and references

- The backend uses `FastAPI`, `langchain`, `langgraph`, and `Supabase` for retrieval.
- The frontend uses Next.js App Router and `@ai-sdk/react` for chat UI and streaming transport.

## Contact

If you need help getting started or want to understand specific implementation details, open an issue or contact the repository maintainer.
