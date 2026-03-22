/**
 * Trace transports for OpenSymbolicAI observability.
 *
 * - InMemoryTransport: stores events in memory (for testing/debugging)
 * - FileTransport: appends JSON lines to a file
 * - HttpTransport: POSTs events to an HTTP endpoint
 */

import { appendFile } from 'fs/promises';
import type { TraceEvent, ITraceTransport } from '../models.js';

/**
 * In-memory transport that stores events in an array.
 * Useful for testing and debugging.
 */
export class InMemoryTransport implements ITraceTransport {
  readonly events: TraceEvent[] = [];

  emit(event: TraceEvent): void {
    this.events.push(event);
  }

  async flush(): Promise<void> {
    // No-op for in-memory
  }

  clear(): void {
    this.events.length = 0;
  }

  getByType(eventType: string): TraceEvent[] {
    return this.events.filter((e) => e.eventType === eventType);
  }
}

/**
 * File transport that appends JSON lines to a file.
 * Each event is written as a single JSON line (JSONL format).
 */
export class FileTransport implements ITraceTransport {
  private filePath: string;
  private buffer: string[] = [];
  private writing = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  emit(event: TraceEvent): void {
    const line = JSON.stringify(event, (_, value) => {
      if (value instanceof Date) return value.toISOString();
      return value;
    });
    this.buffer.push(line + '\n');
  }

  async flush(): Promise<void> {
    if (this.writing || this.buffer.length === 0) return;

    this.writing = true;
    const lines = this.buffer.splice(0);
    try {
      await appendFile(this.filePath, lines.join(''));
    } catch {
      // Re-queue failed lines at the front
      this.buffer.unshift(...lines);
    } finally {
      this.writing = false;
    }
  }
}

/**
 * HTTP transport that POSTs events to an endpoint.
 * Events are batched and sent on flush.
 */
export class HttpTransport implements ITraceTransport {
  private endpoint: string;
  private headers: Record<string, string>;
  private buffer: TraceEvent[] = [];

  constructor(endpoint: string, headers: Record<string, string> = {}) {
    this.endpoint = endpoint;
    this.headers = headers;
  }

  emit(event: TraceEvent): void {
    this.buffer.push(event);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(events, (_, value) => {
          if (value instanceof Date) return value.toISOString();
          return value;
        }),
      });
    } catch {
      // Re-queue failed events at the front
      this.buffer.unshift(...events);
    }
  }
}
