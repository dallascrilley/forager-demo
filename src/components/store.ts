import type { SlackThread, QAEntry } from './types.js';

let _threads: SlackThread[] | null = null;
let _qa: QAEntry[] | null = null;

export async function loadThreads(): Promise<SlackThread[]> {
  if (_threads) return _threads;
  const res = await fetch('/forager/data/threads.json');
  _threads = await res.json();
  return _threads!;
}

export function getThreads(): SlackThread[] | null {
  return _threads;
}

export function getQA(): QAEntry[] | null {
  return _qa;
}

export function setQA(qa: QAEntry[]): void {
  _qa = qa;
}
