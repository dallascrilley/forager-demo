// Single-origin engine entry for EXTERNAL consumers (e.g. the demo-lab storefront).
//
// forager-demo is the canonical source of the knowledge-base engine + types. The
// standalone app imports the local source directly; this barrel is the published
// surface other repos depend on (via the package `exports` map) so the engine has
// ONE origin and can no longer drift. NOTE: store.ts is intentionally NOT exported
// — it carries a repo-specific data-fetch path (chrome), so it stays per-repo.
export { harvestQA, queryKnowledgeBase } from './harvester.js';
export type {
  SlackMessage,
  SlackThread,
  QAEntry,
  QueryResult,
  KnowledgeStats,
  KnowledgeState,
  UploadedKnowledgeResponse,
} from './types.js';
