export interface SlackMessage {
  id: string;
  author: string;
  text: string;
  timestamp: string;
  reactions: string[];
}

export interface SlackThread {
  id: string;
  channel: string;
  title: string;
  messages: SlackMessage[];
  resolved: boolean;
}

export interface QAEntry {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  sources: string[];
  context: string;
  channel: string;
}

export interface QueryResult {
  entry: QAEntry;
  score: number;
}

export interface KnowledgeStats {
  threads: number;
  resolvedThreads: number;
  messages: number;
  qaEntries: number;
}

export interface KnowledgeState {
  source: 'synthetic' | 'uploaded';
  sourceLabel: string;
  sourceDetail: string;
  threads: SlackThread[];
  qa: QAEntry[];
  stats: KnowledgeStats;
}

export interface UploadedKnowledgeResponse {
  source: 'uploaded';
  name: string;
  inputFormat: 'canonical-threads' | 'slack-export-messages';
  threads: SlackThread[];
  qa: QAEntry[];
  stats: KnowledgeStats;
}
