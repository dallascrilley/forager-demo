import { loadThreads, getQA, setQA } from './store.js';
import { harvestQA, queryKnowledgeBase } from './harvester.js';
import type { QAEntry, SlackThread } from './types.js';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function fmtConfidence(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function renderThreadList(threads: SlackThread[]): void {
  const container = el('fg-thread-list');
  if (!container) return;
  container.innerHTML = threads.map(t => `
    <div class="fg-thread" data-id="${t.id}">
      <div class="fg-thread-meta">
        <span class="fg-channel">${t.channel}</span>
        <span class="fg-status ${t.resolved ? 'resolved' : 'open'}">${t.resolved ? 'Resolved' : 'Open'}</span>
      </div>
      <div class="fg-thread-title">${t.title}</div>
      <div class="fg-thread-preview">${t.messages.length} messages</div>
    </div>
  `).join('');

  container.querySelectorAll('.fg-thread').forEach(threadEl => {
    threadEl.addEventListener('click', () => {
      const id = threadEl.getAttribute('data-id');
      const thread = threads.find(t => t.id === id);
      if (thread) showThreadDetail(thread);
    });
  });
}

function showThreadDetail(thread: SlackThread): void {
  const panel = el('fg-detail-panel');
  const qa = getQA();
  if (!panel) return;

  const threadQA = qa?.filter(q => q.sources.includes(thread.id)) || [];

  panel.innerHTML = `
    <div class="fg-detail-header">
      <span class="fg-detail-title">${thread.title}</span>
      <button class="fg-detail-close" aria-label="Close panel">×</button>
    </div>
    <div class="fg-detail-channel">${thread.channel} · ${thread.messages.length} messages · ${thread.resolved ? 'Resolved' : 'Open'}</div>
    <div class="fg-messages">
      ${thread.messages.map(m => `
        <div class="fg-message">
          <div class="fg-message-header">
            <span class="fg-author">${m.author}</span>
            <span class="fg-time">${new Date(m.timestamp).toLocaleString()}</span>
          </div>
          <div class="fg-message-text">${escapeHtml(m.text)}</div>
          ${m.reactions.length ? `<div class="fg-reactions">${m.reactions.map(r => `<span class="fg-reaction">${reactionEmoji(r)}</span>`).join('')}</div>` : ''}
        </div>
      `).join('')}
    </div>
    ${threadQA.length ? `
      <div class="fg-extracted-qa">
        <div class="fg-qa-heading">Extracted Q&A</div>
        ${threadQA.map(q => `
          <div class="fg-qa-card">
            <div class="fg-qa-q">${escapeHtml(q.question)}</div>
            <div class="fg-qa-a">${escapeHtml(q.answer)}</div>
            <div class="fg-qa-meta">Confidence: ${fmtConfidence(q.confidence)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  panel.classList.remove('hidden');
  panel.querySelector('.fg-detail-close')?.addEventListener('click', () => {
    panel.classList.add('hidden');
  });
}

function renderKnowledgeBase(entries: QAEntry[]): void {
  const container = el('fg-kb-list');
  if (!container) return;
  container.innerHTML = entries.map((q, i) => `
    <div class="fg-kb-card" data-index="${i}">
      <div class="fg-kb-q">${escapeHtml(q.question)}</div>
      <div class="fg-kb-a">${escapeHtml(q.answer)}</div>
      <div class="fg-kb-meta">
        <span class="fg-kb-confidence ${q.confidence >= 0.8 ? 'high' : q.confidence >= 0.6 ? 'medium' : 'low'}">${fmtConfidence(q.confidence)}</span>
        <span class="fg-kb-source">${q.channel} · ${q.context}</span>
      </div>
    </div>
  `).join('');
}

function renderQueryResults(results: QAEntry[], query: string): void {
  const container = el('fg-query-results');
  if (!container) return;

  if (results.length === 0) {
    container.innerHTML = `<div class="fg-no-results">No matching knowledge found for "${escapeHtml(query)}".</div>`;
    return;
  }

  container.innerHTML = results.map(q => `
    <div class="fg-result-card">
      <div class="fg-result-answer">${escapeHtml(q.answer)}</div>
      <div class="fg-result-meta">
        <span class="fg-result-confidence ${q.confidence >= 0.8 ? 'high' : q.confidence >= 0.6 ? 'medium' : 'low'}">${fmtConfidence(q.confidence)} confidence</span>
        <span class="fg-result-source">${q.channel} · ${q.context}</span>
      </div>
      <div class="fg-result-citations">
        <div class="fg-citation-heading">Sources</div>
        <div class="fg-citation">${escapeHtml(q.question)}</div>
      </div>
    </div>
  `).join('');
}

function renderMCPResponse(results: QAEntry[], query: string): void {
  const panel = el('fg-mcp-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="fg-mcp-header">
      <span class="fg-mcp-label">MCP Server Response</span>
      <span class="fg-mcp-method">tools/knowledge_query</span>
    </div>
    <div class="fg-mcp-request">
      <div class="fg-mcp-code">{ "query": "${escapeHtml(query)}" }</div>
    </div>
    <div class="fg-mcp-response">
      <div class="fg-mcp-code">${escapeHtml(JSON.stringify({
        results: results.map(r => ({
          answer: r.answer,
          confidence: Math.round(r.confidence * 100) / 100,
          sources: r.sources,
          context: r.context,
        })),
      }, null, 2))}</div>
    </div>
  `;
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

async function init(): Promise<void> {
  const threads = await loadThreads();
  const qa = harvestQA(threads);
  setQA(qa);

  renderThreadList(threads);
  renderKnowledgeBase(qa);

  // Update stats
  const statsEl = el('fg-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <span>${threads.length} threads scanned</span>
      <span>${qa.length} Q&A pairs extracted</span>
      <span>${threads.filter(t => t.resolved).length} resolved</span>
    `;
  }

  // Query wiring
  const queryInput = el('fg-query-input') as HTMLInputElement | null;
  const queryBtn = el('fg-query-btn');

  function doQuery(): void {
    const q = queryInput?.value.trim() || '';
    if (!q) return;
    const results = queryKnowledgeBase(q, qa);
    renderQueryResults(results, q);
    renderMCPResponse(results, q);
  }

  queryBtn?.addEventListener('click', doQuery);
  queryInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doQuery();
  });

  // Harvest button
  const harvestBtn = el('fg-harvest-btn');
  harvestBtn?.addEventListener('click', () => {
    const qa = harvestQA(threads);
    setQA(qa);
    renderKnowledgeBase(qa);
    if (statsEl) {
      statsEl.innerHTML = `
        <span>${threads.length} threads scanned</span>
        <span>${qa.length} Q&A pairs extracted</span>
        <span>${threads.filter(t => t.resolved).length} resolved</span>
      `;
    }
  });
}

init().catch(console.error);
