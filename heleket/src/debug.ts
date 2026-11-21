/**
 * Debug log entry emitted by the SDK when debug mode is on. The API key and
 * the `sign` header are intentionally never included.
 */
export interface DebugEntry {
  kind: 'request' | 'response' | 'error';
  method?: string;
  url?: string;
  body?: string;
  status?: number;
  message?: string;
}

/**
 * User-supplied debug sink. Defaults to writing to stderr when not provided.
 */
export type DebugSink = (entry: DebugEntry) => void;

/**
 * Default sink. Writes a one-line summary per entry to stderr so STDOUT
 * capture is unaffected. Never prints secrets.
 */
export const stderrSink: DebugSink = (entry) => {
  let line: string;
  switch (entry.kind) {
    case 'request':
      line = `[heleket][→ ${entry.method} ${entry.url}] ${entry.body || '(empty body)'}`;
      break;
    case 'response':
      line = `[heleket][← ${entry.status}] ${entry.body || '(empty body)'}`;
      break;
    case 'error':
      line = `[heleket][error] ${entry.message ?? '(no message)'}`;
      break;
  }
  process.stderr.write(line + '\n');
};
