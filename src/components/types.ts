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
