// Unit tests for the ingestion backend's pure logic: format detection, thread
// normalization, Q&A harvesting, and social-signal confidence scoring.
// Run with `pnpm test` (node --test). No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePayload,
  harvestQA,
  scoreConfidence,
  isQuestion,
  hasAnswerSignal,
  inferResolved,
} from '../functions/forager/ingest.js';

test('isQuestion catches explicit and implicit questions', () => {
  assert.ok(isQuestion('How do we handle refunds?'));
  assert.ok(isQuestion('Does the API return Retry-After headers')); // question word, no "?"
  assert.ok(!isQuestion('Shipped the fix to prod.'));
});

test('hasAnswerSignal reads thanks language and helpful reactions', () => {
  assert.ok(hasAnswerSignal({ text: 'thanks, that fixed it', reactions: [] }));
  assert.ok(hasAnswerSignal({ text: 'see above', reactions: ['lightbulb'] }));
  assert.ok(!hasAnswerSignal({ text: 'unrelated chatter', reactions: [] }));
  assert.ok(!hasAnswerSignal(null));
});

test('inferResolved detects resolution language', () => {
  assert.ok(inferResolved([{ text: 'we shipped it, thanks' }]));
  assert.ok(!inferResolved([{ text: 'still investigating' }]));
});

test('parsePayload rejects junk and detects both supported shapes', () => {
  assert.throws(() => parsePayload(''), /Upload a JSON export/);
  assert.throws(() => parsePayload('not json'), /not valid JSON/);
  assert.throws(() => parsePayload(JSON.stringify({ nope: true })), /Unsupported JSON shape/);

  const canonical = parsePayload(
    JSON.stringify([{ channel: '#eng', messages: [{ author: 'a', text: 'hi', timestamp: '2026-01-01T00:00:00Z' }] }])
  );
  assert.equal(canonical.inputFormat, 'canonical-threads');

  const slack = parsePayload(
    JSON.stringify([{ ts: '1700000000.0001', text: 'How do we rotate keys?' }])
  );
  assert.equal(slack.inputFormat, 'slack-export-messages');
});

test('harvestQA pairs a question with its confirmed answer', () => {
  const threads = [
    {
      id: 't1',
      channel: '#eng',
      title: 'key rotation',
      resolved: true,
      messages: [
        { id: 'm1', author: 'asha', text: 'How do we rotate DKIM keys?', timestamp: '2026-01-01T00:00:00Z', reactions: [] },
        { id: 'm2', author: 'ben', text: 'Publish the new selector, wait for propagation, then flip the signing key in the ESP.', timestamp: '2026-01-01T00:01:00Z', reactions: ['plus_one'] },
        { id: 'm3', author: 'asha', text: 'got it, thanks', timestamp: '2026-01-01T00:02:00Z', reactions: [] },
      ],
    },
  ];

  const qa = harvestQA(threads);
  assert.equal(qa.length, 1);
  assert.match(qa[0].question, /rotate DKIM keys/);
  assert.match(qa[0].answer, /Publish the new selector/);
  assert.ok(qa[0].confidence > 0.7); // resolved + plus_one + thanks follow-up
  assert.deepEqual(qa[0].sources, ['t1']);
});

test('scoreConfidence rewards signal but caps below certainty', () => {
  const thread = {
    resolved: true,
    messages: [
      { text: 'q?', reactions: [] },
      { text: 'a', reactions: ['plus_one', 'plus_one', 'fire'] },
      { text: 'thanks, fixed', reactions: [] },
    ],
  };
  const score = scoreConfidence(thread, 1);
  assert.ok(score > 0.9);
  assert.ok(score <= 0.98); // never 1.0
});
