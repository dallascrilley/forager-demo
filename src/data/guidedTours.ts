export const GUIDED_TOURS = {
  forager: {
    repoLabel: 'Forager',
    repoUrl: 'https://github.com/dallascrilley/forager-demo',
    steps: [
      {
        label: 'Upload Slack knowledge',
        body: 'Import a Slack export JSON file or paste normalized thread data; the sample workspace stays clearly synthetic.',
      },
      {
        label: 'Harvest resolved answers',
        body: 'The backend groups messages into threads, extracts Q&A, scores confidence, and switches the UI into your uploaded workspace.',
      },
      {
        label: 'Query like an agent',
        body: 'Ask the harvested knowledge base and inspect the MCP-style response format with source thread, confidence, and answer text.',
      },
    ],
  },
} as const;
