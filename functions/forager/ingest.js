// Cloudflare Pages Function: POST /forager/ingest
//
// Accepts a real Slack export (channel message array) OR a normalized thread
// array, groups messages into threads, harvests Q&A pairs, and scores each by
// social signal. Stateless: nothing is stored; the request body is the only
// input. Pure helpers are exported for unit tests; Cloudflare routes only
// `onRequestPost`.

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
    ...init,
  });
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeReactionName(reaction) {
  if (!reaction) return null;
  if (typeof reaction === 'string') return reaction;
  if (typeof reaction.name === 'string') return reaction.name;
  return null;
}

function sortMessages(messages) {
  return [...messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function inferResolved(messages) {
  return messages.some((message) => /\b(resolved|fixed|shipped|done|thanks|thank you|that worked|got it)\b/i.test(message.text));
}

// Accepts the demo's own normalized shape: [{ channel, messages: [...] }].
export function normalizeCanonicalThreads(payload) {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  if (!payload.every((item) => item && typeof item === 'object' && Array.isArray(item.messages))) return null;

  return payload.map((thread, index) => {
    const channel = typeof thread.channel === 'string' && thread.channel ? thread.channel : '#imported';
    const messages = sortMessages(
      toArray(thread.messages)
        .filter((message) => message && typeof message === 'object' && typeof message.text === 'string')
        .map((message, messageIndex) => ({
          id: typeof message.id === 'string' && message.id ? message.id : `${thread.id || `thread_${index + 1}`}_m_${messageIndex + 1}`,
          author:
            typeof message.author === 'string' && message.author
              ? message.author
              : typeof message.user === 'string' && message.user
                ? message.user
                : 'unknown',
          text: message.text,
          timestamp:
            typeof message.timestamp === 'string' && message.timestamp
              ? message.timestamp
              : typeof message.ts === 'string' && message.ts
                ? new Date(Number.parseFloat(message.ts) * 1000).toISOString()
                : new Date(0).toISOString(),
          reactions: toArray(message.reactions).map(normalizeReactionName).filter(Boolean),
        }))
    );

    const title =
      typeof thread.title === 'string' && thread.title
        ? thread.title
        : messages.find((message) => /\?/.test(message.text))?.text.slice(0, 80) || `Imported thread ${index + 1}`;

    return {
      id: typeof thread.id === 'string' && thread.id ? thread.id : `thread_${index + 1}`,
      channel,
      title,
      messages,
      resolved: typeof thread.resolved === 'boolean' ? thread.resolved : inferResolved(messages),
    };
  });
}

// Accepts a raw Slack channel export: [{ ts, text, thread_ts?, reactions?, ... }].
export function normalizeSlackExportMessages(payload) {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  if (!payload.every((item) => item && typeof item === 'object' && typeof item.text === 'string' && typeof item.ts === 'string')) return null;

  const grouped = new Map();

  for (const item of payload) {
    const threadKey = item.thread_ts || item.ts;
    if (!grouped.has(threadKey)) grouped.set(threadKey, []);
    grouped.get(threadKey).push(item);
  }

  const threads = [...grouped.entries()]
    .map(([threadKey, items], index) => {
      const ordered = [...items].sort((a, b) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts));
      const channelName =
        typeof ordered[0].channel === 'string' && ordered[0].channel
          ? ordered[0].channel
          : typeof ordered[0].channel_name === 'string' && ordered[0].channel_name
            ? ordered[0].channel_name
            : 'imported';
      const messages = ordered.map((message, messageIndex) => ({
        id: typeof message.client_msg_id === 'string' && message.client_msg_id ? message.client_msg_id : `${threadKey}_${messageIndex + 1}`,
        author:
          typeof message.user_profile?.display_name === 'string' && message.user_profile.display_name
            ? message.user_profile.display_name
            : typeof message.user_profile?.real_name === 'string' && message.user_profile.real_name
              ? message.user_profile.real_name
              : typeof message.user === 'string' && message.user
                ? message.user
                : 'unknown',
        text: message.text,
        timestamp: new Date(Number.parseFloat(message.ts) * 1000).toISOString(),
        reactions: toArray(message.reactions).map(normalizeReactionName).filter(Boolean),
      }));
      const firstQuestion = messages.find((message) => /\?/.test(message.text));
      return {
        id: `slack_${threadKey.replace('.', '_')}`,
        channel: channelName.startsWith('#') ? channelName : `#${channelName}`,
        title: firstQuestion ? firstQuestion.text.slice(0, 80) : messages[0]?.text.slice(0, 80) || `Imported thread ${index + 1}`,
        messages,
        resolved: inferResolved(messages),
      };
    })
    .filter((thread) => thread.messages.length > 0);

  return threads;
}

export function isQuestion(text) {
  return text.trim().endsWith('?') || /\b(how|what|when|where|why|does|do|can|should|is|are)\b/i.test(text.split('.')[0] || '');
}

export function hasAnswerSignal(nextMessage) {
  if (!nextMessage) return false;
  const thanks = /\b(thanks|thank you|got it|makes sense|will do|implementing|fixed|noted)\b/i;
  const helpfulReactions = ['lightbulb', 'plus_one', 'check', 'fire'];
  return thanks.test(nextMessage.text) || helpfulReactions.some((reaction) => nextMessage.reactions.includes(reaction));
}

// Confidence is derived from social signal, never assigned arbitrarily, and
// caps at 0.98 — extracted knowledge is never certain.
export function scoreConfidence(thread, answerIdx) {
  let score = 0.5;
  if (thread.resolved) score += 0.2;
  const answerMessage = thread.messages[answerIdx];
  if (answerMessage.reactions.includes('plus_one')) {
    score += 0.1 * Math.min(answerMessage.reactions.filter((reaction) => reaction === 'plus_one').length, 2);
  }
  if (answerMessage.reactions.includes('fire')) score += 0.1;
  const thanksMessage = thread.messages[answerIdx + 1];
  if (thanksMessage && /\b(thanks|thank you|got it|fixed)\b/i.test(thanksMessage.text)) score += 0.1;
  return Math.min(score, 0.98);
}

export function harvestQA(threads) {
  const entries = [];
  for (const thread of threads) {
    for (let i = 0; i < thread.messages.length; i += 1) {
      const message = thread.messages[i];
      if (!isQuestion(message.text)) continue;

      let bestAnswerIdx = -1;
      for (let j = i + 1; j < thread.messages.length; j += 1) {
        const candidate = thread.messages[j];
        if (isQuestion(candidate.text)) break;
        if (hasAnswerSignal(thread.messages[j + 1]) || candidate.reactions.includes('lightbulb')) {
          bestAnswerIdx = j;
          break;
        }
        if (bestAnswerIdx === -1 && candidate.text.length > 40) {
          bestAnswerIdx = j;
        }
      }

      if (bestAnswerIdx === -1) continue;

      entries.push({
        id: `${thread.id}_qa_${i}`,
        question: message.text,
        answer: thread.messages[bestAnswerIdx].text,
        confidence: scoreConfidence(thread, bestAnswerIdx),
        sources: [thread.id],
        context: thread.title,
        channel: thread.channel,
      });
    }
  }

  return entries.sort((a, b) => b.confidence - a.confidence);
}

export function parsePayload(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Upload a JSON export or paste normalized thread JSON.');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Input is not valid JSON.');
  }

  const canonical = normalizeCanonicalThreads(parsed);
  if (canonical) {
    return { threads: canonical, inputFormat: 'canonical-threads' };
  }

  const slackExport = normalizeSlackExportMessages(parsed);
  if (slackExport) {
    return { threads: slackExport, inputFormat: 'slack-export-messages' };
  }

  throw new Error('Unsupported JSON shape. Use a Slack export channel file or an array of normalized threads.');
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { raw, name } = body || {};
    const { threads, inputFormat } = parsePayload(raw);
    const qa = harvestQA(threads);

    return json({
      source: 'uploaded',
      name: typeof name === 'string' && name ? name : 'uploaded-export.json',
      inputFormat,
      threads,
      qa,
      stats: {
        threads: threads.length,
        resolvedThreads: threads.filter((thread) => thread.resolved).length,
        messages: threads.reduce((sum, thread) => sum + thread.messages.length, 0),
        qaEntries: qa.length,
      },
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Import failed.',
      },
      { status: 400 }
    );
  }
}
