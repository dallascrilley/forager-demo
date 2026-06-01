import type { SlackThread, SlackMessage, QAEntry } from './types.js';

function isQuestion(text: string): boolean {
  return text.trim().endsWith('?') || /\b(how|what|when|where|why|does|do|can|should|is|are)\b/i.test(text.split('.')[0]);
}

function hasAnswerSignal(msg: SlackMessage, nextMsg?: SlackMessage): boolean {
  if (!nextMsg) return false;
  const thanks = /\b(thanks|thank you|got it|makes sense|will do|implementing|fixed|noted)\b/i;
  const helpfulReactions = ['lightbulb', 'plus_one', 'check', 'fire'];
  return thanks.test(nextMsg.text) || helpfulReactions.some(r => nextMsg.reactions.includes(r));
}

function scoreConfidence(thread: SlackThread, qIdx: number, aIdx: number): number {
  let score = 0.5;
  if (thread.resolved) score += 0.2;
  const answerMsg = thread.messages[aIdx];
  if (answerMsg.reactions.includes('plus_one')) score += 0.1 * Math.min(answerMsg.reactions.filter(r => r === 'plus_one').length, 2);
  if (answerMsg.reactions.includes('fire')) score += 0.1;
  const thanksMsg = thread.messages[aIdx + 1];
  if (thanksMsg && /\b(thanks|thank you|got it|fixed)\b/i.test(thanksMsg.text)) score += 0.1;
  return Math.min(score, 0.98);
}

export function harvestQA(threads: SlackThread[]): QAEntry[] {
  const entries: QAEntry[] = [];

  for (const thread of threads) {
    for (let i = 0; i < thread.messages.length; i++) {
      const msg = thread.messages[i];
      if (!isQuestion(msg.text)) continue;

      // Look for the best answer in subsequent messages
      let bestAnswerIdx = -1;
      for (let j = i + 1; j < thread.messages.length; j++) {
        const candidate = thread.messages[j];
        if (isQuestion(candidate.text)) break; // new question ends this Q&A
        if (hasAnswerSignal(msg, thread.messages[j + 1]) || candidate.reactions.includes('lightbulb')) {
          bestAnswerIdx = j;
          break;
        }
        if (bestAnswerIdx === -1 && candidate.text.length > 40) {
          bestAnswerIdx = j; // fallback: longest substantive reply
        }
      }

      if (bestAnswerIdx === -1) continue;

      const confidence = scoreConfidence(thread, i, bestAnswerIdx);
      entries.push({
        id: `${thread.id}_qa_${i}`,
        question: msg.text,
        answer: thread.messages[bestAnswerIdx].text,
        confidence,
        sources: [thread.id],
        context: thread.title,
        channel: thread.channel,
      });
    }
  }

  return entries.sort((a, b) => b.confidence - a.confidence);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(t => t.length > 2);
}

function overlapScore(query: string[], text: string[]): number {
  const set = new Set(text);
  let hits = 0;
  for (const t of query) {
    if (set.has(t)) hits++;
  }
  return hits / query.length;
}

export function queryKnowledgeBase(query: string, entries: QAEntry[]): QAEntry[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return entries.slice(0, 5);

  const scored = entries.map(entry => {
    const qTokensEntry = tokenize(entry.question);
    const aTokensEntry = tokenize(entry.answer);
    const cTokensEntry = tokenize(entry.context);
    const score = overlapScore(qTokens, qTokensEntry) * 3 +
                  overlapScore(qTokens, aTokensEntry) * 2 +
                  overlapScore(qTokens, cTokensEntry) * 1;
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).map(s => s.entry).slice(0, 5);
}
