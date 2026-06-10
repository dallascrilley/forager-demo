import { ingestUploadedThreads, loadSyntheticState, resetToSynthetic } from './store.js';
import { queryKnowledgeBase } from './harvester.js';
import type { KnowledgeState, QAEntry, SlackThread } from './types.js';

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function fmtConfidence(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function reactionEmoji(name: string): string {
  const map: Record<string, string> = {
    question: '❓',
    lightbulb: '💡',
    plus_one: '👍',
    check: '✅',
    fire: '🔥',
  };
  return map[name] || name;
}

let currentState: KnowledgeState | null = null;

function updateModeBadge(state: KnowledgeState): void {
  const badge = el('fr-mode-badge');
  const banner = el('fr-banner-copy');
  const sourceTitle = el('fr-source-title');
  const sourceDetail = el('fr-source-detail');
  const uploadStatus = el('fr-upload-status');
  if (badge) badge.textContent = state.source === 'uploaded' ? 'Uploaded real data' : 'Synthetic sample mode';
  if (banner) {
    banner.innerHTML =
      state.source === 'uploaded'
        ? '<strong>Uploaded workspace loaded.</strong> This session is now running against your own exported Slack data through a backend import endpoint. <em>No live Slack OAuth, but the threads and extracted answers are real.</em>'
        : '<strong>Synthetic workspace only.</strong> These 10 Slack threads are fabricated, but the Q&A extraction logic, confidence scoring, and MCP response format are production-grade. <em>No real Slack data, no live API calls.</em>';
  }
  if (sourceTitle) sourceTitle.textContent = state.sourceLabel;
  if (sourceDetail) sourceDetail.textContent = state.sourceDetail;
  if (uploadStatus && state.source === 'synthetic' && !uploadStatus.textContent) {
    uploadStatus.textContent = 'Upload a Slack export JSON file or paste normalized thread JSON.';
  }
}

function renderThreadList(threads: SlackThread[]): void {
  const container = el('fr-thread-list');
  if (!container) return;
  container.innerHTML = threads
    .map(
      (thread) => `
    <div class="fr-thread" data-id="${escapeHtml(thread.id)}" role="button" tabindex="0" aria-label="Open thread: ${escapeHtml(thread.title)}">
      <div class="fr-thread-meta">
        <span class="fr-channel">${escapeHtml(thread.channel)}</span>
        <span class="fr-status ${thread.resolved ? 'resolved' : 'open'}">${thread.resolved ? 'Resolved' : 'Open'}</span>
      </div>
      <div class="fr-thread-title">${escapeHtml(thread.title)}</div>
      <div class="fr-thread-preview">${thread.messages.length} messages</div>
    </div>
  `
    )
    .join('');

  container.querySelectorAll<HTMLElement>('.fr-thread').forEach((threadEl) => {
    const open = (): void => {
      const id = threadEl.getAttribute('data-id');
      const thread = threads.find((candidate) => candidate.id === id);
      if (thread) showThreadDetail(thread);
    };
    threadEl.addEventListener('click', open);
    threadEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function showThreadDetail(thread: SlackThread): void {
  const panel = el('fr-detail-panel');
  if (!panel || !currentState) return;

  const threadQA = currentState.qa.filter((entry) => entry.sources.includes(thread.id));
  panel.innerHTML = `
    <div class="fr-detail-header">
      <span class="fr-detail-title">${escapeHtml(thread.title)}</span>
      <button class="fr-detail-close" aria-label="Close panel">×</button>
    </div>
    <div class="fr-detail-channel">${escapeHtml(thread.channel)} · ${thread.messages.length} messages · ${thread.resolved ? 'Resolved' : 'Open'}</div>
    <div class="fr-messages">
      ${thread.messages
        .map(
          (message) => `
        <div class="fr-message">
          <div class="fr-message-header">
            <span class="fr-author">${escapeHtml(message.author)}</span>
            <span class="fr-time">${escapeHtml(new Date(message.timestamp).toLocaleString())}</span>
          </div>
          <div class="fr-message-text">${escapeHtml(message.text)}</div>
          ${message.reactions.length ? `<div class="fr-reactions">${message.reactions.map((reaction) => `<span class="fr-reaction">${reactionEmoji(reaction)}</span>`).join('')}</div>` : ''}
        </div>
      `
        )
        .join('')}
    </div>
    ${
      threadQA.length
        ? `
      <div class="fr-extracted-qa">
        <div class="fr-qa-heading">Extracted Q&A</div>
        ${threadQA
          .map(
            (entry) => `
          <div class="fr-qa-card">
            <div class="fr-qa-q">${escapeHtml(entry.question)}</div>
            <div class="fr-qa-a">${escapeHtml(entry.answer)}</div>
            <div class="fr-qa-meta">Confidence: ${fmtConfidence(entry.confidence)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    `
        : ''
    }
  `;

  panel.classList.remove('hidden');
  panel.querySelector('.fr-detail-close')?.addEventListener('click', () => {
    panel.classList.add('hidden');
  });
}

function renderKnowledgeBase(entries: QAEntry[]): void {
  const container = el('fr-kb-list');
  if (!container) return;
  container.innerHTML = entries
    .map(
      (entry, index) => `
    <div class="fr-kb-card" data-index="${index}">
      <div class="fr-kb-q">${escapeHtml(entry.question)}</div>
      <div class="fr-kb-a">${escapeHtml(entry.answer)}</div>
      <div class="fr-kb-meta">
        <span class="fr-kb-confidence ${entry.confidence >= 0.8 ? 'high' : entry.confidence >= 0.6 ? 'medium' : 'low'}">${fmtConfidence(entry.confidence)}</span>
        <span class="fr-kb-source">${escapeHtml(entry.channel)} · ${escapeHtml(entry.context)}</span>
      </div>
    </div>
  `
    )
    .join('');
}

function renderQueryResults(results: QAEntry[], query: string): void {
  const container = el('fr-query-results');
  if (!container) return;
  if (results.length === 0) {
    container.innerHTML = `<div class="fr-no-results">No matching knowledge found for "${escapeHtml(query)}".</div>`;
    return;
  }

  container.innerHTML = results
    .map(
      (entry) => `
    <div class="fr-result-card">
      <div class="fr-result-answer">${escapeHtml(entry.answer)}</div>
      <div class="fr-result-meta">
        <span class="fr-result-confidence ${entry.confidence >= 0.8 ? 'high' : entry.confidence >= 0.6 ? 'medium' : 'low'}">${fmtConfidence(entry.confidence)} confidence</span>
        <span class="fr-result-source">${escapeHtml(entry.channel)} · ${escapeHtml(entry.context)}</span>
      </div>
      <div class="fr-result-citations">
        <div class="fr-citation-heading">Sources</div>
        <div class="fr-citation">${escapeHtml(entry.question)}</div>
      </div>
    </div>
  `
    )
    .join('');
}

function renderMCPResponse(results: QAEntry[], query: string): void {
  const panel = el('fr-mcp-panel');
  if (!panel || !currentState) return;

  panel.innerHTML = `
    <div class="fr-mcp-header">
      <span class="fr-mcp-label">MCP Server Response</span>
      <span class="fr-mcp-method">tools/knowledge_query</span>
    </div>
    <div class="fr-mcp-request">
      <div class="fr-mcp-code">{ "query": "${escapeHtml(query)}", "source": "${escapeHtml(currentState.source)}" }</div>
    </div>
    <div class="fr-mcp-response">
      <div class="fr-mcp-code">${escapeHtml(
        JSON.stringify(
          {
            source: currentState.source,
            sourceLabel: currentState.sourceLabel,
            results: results.map((entry) => ({
              answer: entry.answer,
              confidence: Math.round(entry.confidence * 100) / 100,
              sources: entry.sources,
              context: entry.context,
            })),
          },
          null,
          2
        )
      )}</div>
    </div>
  `;
}

function renderStats(state: KnowledgeState): void {
  const statsEl = el('fr-stats');
  if (!statsEl) return;
  statsEl.innerHTML = `
    <span>${state.stats.threads} threads</span>
    <span>${state.stats.qaEntries} Q&A</span>
    <span>${state.stats.resolvedThreads} resolved</span>
    <span>${state.stats.messages} messages</span>
  `;
}

function renderState(state: KnowledgeState): void {
  currentState = state;
  updateModeBadge(state);
  renderThreadList(state.threads);
  renderKnowledgeBase(state.qa);
  renderStats(state);

  const panel = el('fr-detail-panel');
  if (panel) panel.classList.add('hidden');

  const queryResults = el('fr-query-results');
  if (queryResults) queryResults.innerHTML = '';
  const mcpPanel = el('fr-mcp-panel');
  if (mcpPanel) {
    mcpPanel.innerHTML = '<div class="fr-mcp-placeholder">Query the knowledge base to see the MCP response format.</div>';
  }
}

function wireQuery(): void {
  const queryInput = el<HTMLInputElement>('fr-query-input');
  const queryBtn = el('fr-query-btn');

  const runQuery = (): void => {
    const query = queryInput?.value.trim() || '';
    if (!query || !currentState) return;
    const results = queryKnowledgeBase(query, currentState.qa);
    renderQueryResults(results, query);
    renderMCPResponse(results, query);
  };

  queryBtn?.addEventListener('click', runQuery);
  queryInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runQuery();
  });
}

function wireModeControls(): void {
  const fileInput = el<HTMLInputElement>('fr-upload-file');
  const textArea = el<HTMLTextAreaElement>('fr-upload-text');
  const importBtn = el<HTMLButtonElement>('fr-import-btn');
  const sampleBtn = el<HTMLButtonElement>('fr-sample-btn');
  const reharvestBtn = el<HTMLButtonElement>('fr-harvest-btn');
  const uploadStatus = el('fr-upload-status');

  async function readSelectedPayload(): Promise<{ raw: string; name: string }> {
    const file = fileInput?.files?.[0];
    if (file) {
      return { raw: await file.text(), name: file.name };
    }
    const raw = textArea?.value.trim() || '';
    if (raw) return { raw, name: 'pasted-threads.json' };
    throw new Error('Choose a JSON file or paste JSON first.');
  }

  importBtn?.addEventListener('click', async () => {
    if (!importBtn || !uploadStatus) return;
    importBtn.disabled = true;
    uploadStatus.textContent = 'Importing workspace export…';
    uploadStatus.dataset.state = 'loading';
    try {
      const { raw, name } = await readSelectedPayload();
      const state = await ingestUploadedThreads(raw, name);
      renderState(state);
      uploadStatus.textContent = `Loaded ${state.stats.threads} threads from ${name}.`;
      uploadStatus.dataset.state = 'ok';
      if (textArea) textArea.value = '';
      if (fileInput) fileInput.value = '';
    } catch (error) {
      uploadStatus.textContent = error instanceof Error ? error.message : 'Import failed.';
      uploadStatus.dataset.state = 'error';
    } finally {
      importBtn.disabled = false;
    }
  });

  sampleBtn?.addEventListener('click', async () => {
    if (!uploadStatus) return;
    const state = await resetToSynthetic();
    renderState(state);
    uploadStatus.textContent = 'Restored the built-in synthetic sample workspace.';
    uploadStatus.dataset.state = 'ok';
  });

  reharvestBtn?.addEventListener('click', () => {
    if (!currentState || !uploadStatus) return;
    renderState(currentState);
    uploadStatus.textContent = currentState.source === 'uploaded' ? 'Re-rendered the current uploaded workspace.' : 'Re-rendered the synthetic sample workspace.';
    uploadStatus.dataset.state = 'ok';
  });
}

async function init(): Promise<void> {
  const state = await loadSyntheticState();
  renderState(state);
  wireQuery();
  wireModeControls();
}

init().catch(console.error);
