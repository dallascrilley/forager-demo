# Forager Architecture

## Stack

- **Astro 5** — static site generator
- **TypeScript** — vanilla TS, no framework; the UI is a three-panel dashboard
- **No backend, no API keys, no environment variables**

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

## What was cut for scope

- **Real Slack OAuth** — no live workspace connection
- **Vector embeddings** — keyword only
- **Persistent storage** — in-memory only
- **Real MCP transport** — JSON simulation only
- **Multi-workspace support** — single synthetic workspace

## How to extend to production

A production version would need:
1. Slack OAuth + Event API integration for live thread ingestion
2. Vector embedding layer (OpenAI, Cohere, or local) for semantic matching
3. Persistent vector store (Pinecone, Weaviate, or pgvector) for cross-workspace search
4. Real MCP server implementation with stdio or SSE transport
5. Answer versioning and drift detection (when the accepted answer changes over time)
6. Admin review queue for low-confidence extractions

## Performance

- Harvest: <5ms for 10 threads
- Query: <1ms for keyword matching
- Bundle: ~7 KB gzipped (Astro + app code, no external deps)
