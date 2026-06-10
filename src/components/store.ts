import type { KnowledgeState, SlackThread, UploadedKnowledgeResponse } from './types.js';
import { harvestQA } from './harvester.js';

let _state: KnowledgeState | null = null;

function buildSyntheticState(threads: SlackThread[]): KnowledgeState {
  const qa = harvestQA(threads);
  return {
    source: 'synthetic',
    sourceLabel: 'Sample workspace',
    sourceDetail: '10 fabricated Slack threads with realistic failure-and-resolution patterns.',
    threads,
    qa,
    stats: {
      threads: threads.length,
      resolvedThreads: threads.filter((thread) => thread.resolved).length,
      messages: threads.reduce((sum, thread) => sum + thread.messages.length, 0),
      qaEntries: qa.length,
    },
  };
}

export async function loadSyntheticState(): Promise<KnowledgeState> {
  if (_state && _state.source === 'synthetic') return _state;
  const res = await fetch('/data/threads.json');
  const threads: SlackThread[] = await res.json();
  _state = buildSyntheticState(threads);
  return _state;
}

export async function ingestUploadedThreads(raw: string, name: string): Promise<KnowledgeState> {
  const res = await fetch('/forager/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw, name }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const message = payload && typeof payload.error === 'string' ? payload.error : `Import failed (${res.status})`;
    throw new Error(message);
  }

  const payload: UploadedKnowledgeResponse = await res.json();
  _state = {
    source: 'uploaded',
    sourceLabel: `Uploaded export · ${payload.name}`,
    sourceDetail:
      payload.inputFormat === 'slack-export-messages'
        ? 'Parsed a real Slack export channel file grouped into thread conversations.'
        : 'Parsed normalized thread JSON uploaded from your own workspace export.',
    threads: payload.threads,
    qa: payload.qa,
    stats: payload.stats,
  };
  return _state;
}

export function getState(): KnowledgeState | null {
  return _state;
}

export function resetToSynthetic(): Promise<KnowledgeState> {
  _state = null;
  return loadSyntheticState();
}
