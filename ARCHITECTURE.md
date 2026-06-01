# Forager Architecture

## Stack

- **Astro 5** — static site generator
- **TypeScript** — vanilla TS, no framework; the UI is a three-panel dashboard
- **Cloudflare Pages Function** — one serverless endpoint for real Slack-export ingestion
- **No API keys, no environment variables, no stored state** — uploads are processed in-request and discarded

## Live backend

`functions/forager/ingest.js` handles `POST /forager/ingest` and runs the harvest pipeline server-side on data you upload:

1. **Auto-detect input shape** — a raw Slack channel export (`[{ ts, text, thread_ts?, reactions?, user_profile? }]`) or the demo's normalized thread array. Malformed input is rejected with a specific error.
2. **Group into threads** by `thread_ts` (falling back to `ts`), normalizing authors, timestamps, and reaction names.
3. **Harvest Q&A** with `harvestQA()` (below) and **score confidence** from social signal.
4. **Return** threads, Q&A entries, and stats with `source: "uploaded"` and the detected `inputFormat`.

The pipeline is stateless and identical whether the input is the synthetic sample or a real uploaded export — the sample is just the zero-friction path. Pure helpers (`parsePayload`, `harvestQA`, `scoreConfidence`, …) are exported and unit-tested in `tests/ingest.test.js`.

## Data model

```typescript
interface SlackThread {
  id: string;
  channel: string;
  title: string;
  messages: SlackMessage[];
  resolved: boolean;
}

interface SlackMessage {
  id: string;
  author: string;
  text: string;
  timestamp: string;
  reactions: string[];
}

interface QAEntry {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  sources: string[];
  context: string;
  channel: string;
}
```

## The harvester

The `harvestQA()` function runs a four-stage pipeline:

### 1. Question detection
A message is a question if:
- It ends with `?`
- OR its first sentence contains a question word (`how`, `what`, `when`, `where`, `why`, `does`, `do`, `can`, `should`, `is`, `are`)

This catches both explicit questions ("How do we handle refunds?") and implicit ones ("Does our API return Retry-After headers?").

### 2. Answer resolution
For each question, scan subsequent messages until:
- A new question is found (ends the current Q&A scope)
- A message with helpful reactions (💡, 👍) is found
- A follow-up message contains confirmation language ("thanks", "got it", "fixed")

If no explicit signal is found, fall back to the longest substantive reply (>40 chars).

### 3. Confidence scoring
Base score: 0.5
- +0.2 if the thread is marked resolved
- +0.1 per "plus_one" reaction on the answer (capped at 0.2)
- +0.1 if the answer has "fire" reactions
- +0.1 if the next message contains "thanks" / "got it" / "fixed"

Maximum: 0.98. No answer gets 1.0 — there is always uncertainty in extracted knowledge.

### 4. Query matching
Token overlap scoring across three fields:
- Question text: 3× weight
- Answer text: 2× weight
- Thread context (title): 1× weight

Results are sorted by composite score and filtered to score > 0.

## Why keyword matching instead of embeddings

For a 10-thread, client-side demo, loading a 50 MB transformer model or calling an embedding API would violate the zero-backend constraint. Keyword matching with weighted fields is:
- **Deterministic** — same query, same results every time
- **Inspectable** — you can trace exactly why a result matched
- **Fast** — <1ms per query on modern hardware
- **Honest** — it fails visibly on semantic mismatch ("connection pool" vs. "PgBouncer"), rather than returning a low-confidence embedding similarity that looks authoritative

A production version would use hybrid scoring: keyword for exact matches, embeddings for paraphrase and synonym handling.

## MCP simulation

The right panel shows a simulated MCP server response. When a user queries, the panel renders:
- The request as JSON (`{ query: "..." }`)
- The response as structured JSON with `answer`, `confidence`, `sources`, and `context`

This is not a real MCP server (no stdio transport, no `list_tools` handshake), but it demonstrates fluency with the protocol shape that agent platforms like Claude Desktop and Hightouch use.

## File map

| File | Responsibility |
|---|---|
| `src/pages/index.astro` | Shell: nav, banner, three-panel layout |
| `src/components/app.ts` | Bootstrap, thread list, KB list, query wiring, detail panel, MCP panel |
| `src/components/harvester.ts` | Q&A extraction, confidence scoring, query matching |
| `src/components/store.ts` | Data loading singleton |
| `src/components/types.ts` | Shared TypeScript interfaces |
| `src/styles/forager.css` | All styles — dark theme, three-panel grid, responsive breakpoints |

## What is live vs. cut for scope

**Live:** ingestion and harvesting run server-side on real uploaded Slack exports (see [Live backend](#live-backend)).

Cut for scope:
- **Real Slack OAuth** — ingest works on exports, but there is no live workspace connection / Event API
- **Vector embeddings** — keyword matching only (see below)
- **Persistent storage** — each request is independent; nothing is stored
- **Real MCP transport** — JSON simulation only, no stdio/SSE handshake
- **Multi-workspace support** — one export at a time

## How to extend to production

The upload path already proves ingestion + harvesting on real data. A production version would add:
1. Slack OAuth + Event API for live, continuous thread ingestion
2. Vector embedding layer (OpenAI, Cohere, or local) for semantic matching
3. Persistent vector store (Pinecone, Weaviate, or pgvector) for cross-workspace search
4. Real MCP server implementation with stdio or SSE transport
5. Answer versioning and drift detection (when the accepted answer changes over time)
6. Admin review queue for low-confidence extractions

## Performance

- Harvest: <5ms for 10 threads
- Query: <1ms for keyword matching
- Bundle: ~7 KB gzipped (Astro + app code, no external deps)
