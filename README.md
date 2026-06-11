# Forager

[![CI](https://github.com/dallascrilley/forager-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/dallascrilley/forager-demo/actions/workflows/ci.yml)

> **Your tribal knowledge is in Slack. Stop pretending the wiki has it.**

Forager turns resolved Slack threads into a queryable Q&A knowledge base with confidence scoring. It is a **hybrid proof**: a real backend ingests an actual Slack export you upload — grouping messages into threads, harvesting question/answer pairs, and scoring each by social signal — while live OAuth and semantic search are explicitly out of scope.

**Live demo:** [dallascrilley.com/demos/forager](https://dallascrilley.com/demos/forager) — explore the synthetic sample, or upload a real Slack channel export and watch it get harvested server-side.

## Real vs. synthetic — the honest boundary

| Capability | Source |
|---|---|
| Ingest a real Slack channel export (`ts`/`thread_ts`/`reactions`) | **Live** — server-side parsing of your uploaded JSON |
| Thread grouping, Q&A harvesting, confidence scoring | **Live** — runs in the backend on real input |
| Sample workspace (no upload) | Synthetic — `public/data/threads.json` |
| Live Slack connection | Out of scope — no OAuth / Event API |
| Semantic retrieval | Out of scope — matching is keyword-based, not embeddings |

The synthetic sample lets a reviewer try it instantly; uploading a real export proves the ingestion and harvesting logic works on genuine workspace data.

## The backend

[`functions/forager/ingest.js`](functions/forager/ingest.js) is a **Cloudflare Pages Function** — `POST /forager/ingest`. It:

- accepts **either** a raw Slack channel export (`[{ ts, text, thread_ts?, reactions?, user_profile? }]`) **or** the demo's normalized thread shape, and auto-detects which;
- groups messages into threads by `thread_ts`, then harvests Q&A: detect questions, resolve each to its confirmed answer (reaction/thanks signal, or longest substantive reply), and **score confidence from social signal** — resolution status, 👍/🔥 reactions, confirmation language — capped at 0.98 because extracted knowledge is never certain;
- is **stateless** — the request body is the only input; nothing is stored.

```bash
curl -X POST https://dallascrilley.com/demos/forager/ingest \
  -H 'content-type: application/json' \
  -d '{"raw":"[{\"ts\":\"1700000000.0001\",\"text\":\"How do we rotate DKIM keys?\"}]"}'
```

The ingestion and scoring logic are pure functions, exported and unit-tested in [`tests/ingest.test.js`](tests/ingest.test.js).

## Run locally

```bash
pnpm install
pnpm test                                    # unit tests for harvesting + scoring
pnpm dev                                     # static UI only — http://localhost:4321 (synthetic sample)
pnpm build && npx wrangler pages dev dist    # UI + live /forager/ingest — http://localhost:8788
```

Uploads reach the backend only under `wrangler pages dev` (port **8788**); `pnpm dev` (port 4321) serves the synthetic UI alone.

## What it proves

- **Knowledge-extraction pipeline design** — question detection → answer resolution → confidence scoring, on real Slack-export structure.
- **Defensive ingestion** — two input shapes auto-detected, malformed input rejected with clear errors.
- **Confidence from evidence, not vibes** — scores derive from reactions and resolution signals and never reach certainty.
- **Honest system boundaries** — the live/synthetic and "no OAuth, no embeddings" lines are explicit in the UI, the API response (`source`, `inputFormat`), and this README.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data model, harvester pipeline, scoring formula, backend design, and tradeoffs.

## License

MIT
