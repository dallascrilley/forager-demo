# Forager

> **Your tribal knowledge is in Slack. Stop pretending the wiki has it.**

Forager is a client-side knowledge harvester that turns resolved Slack threads into a queryable Q&A base with confidence scoring. It demonstrates RAG pipeline design, social-signal-based confidence scoring, and MCP server response formatting — all without a backend.

**Live demo:** [demos.dallascrilley.com/forager](https://demos.dallascrilley.com/forager)

## What it proves

- **RAG over unstructured conversations** — retrieval from Slack-style threads using keyword overlap scoring, not just vector similarity.
- **Confidence scoring from social signals** — answer quality is derived from reactions (💡, 👍), resolution status, and confirmation language, not arbitrary assignment.
- **MCP fluency** — the query panel simulates an MCP server response format, showing understanding of agent-tool contracts.
- **Zero-backend architecture** — all parsing, scoring, and matching runs in vanilla TypeScript. No API keys, no data egress.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4321`. The demo loads 10 synthetic Slack threads from `public/data/threads.json`.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design decisions, harvester logic, and tradeoffs.

## Honest limits

- **No real Slack connection** — synthetic threads only. No OAuth, no live API.
- **No vector embeddings** — matching is keyword-based, not semantic.
- **No persistent storage** — knowledge base is in-memory only.
- **No real MCP server** — the response panel simulates JSON format; no stdio or SSE transport.

## License

MIT
