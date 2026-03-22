/**
 * Tracer - Structured tracing system for OpenSymbolicAI.
 *
 * Manages trace/span hierarchies and emits events to configured transports.
 * Analogous to the .NET Tracer with trace/span ID management.
 */

import { randomBytes } from 'crypto';
import type { EventType, TraceEvent, ITraceTransport, ObservabilityConfig } from '../models.js';

function generateId(): string {
  return randomBytes(8).toString('hex');
}

export class Span {
  readonly spanId: string;
  readonly parentSpanId?: string;
  private tracer: Tracer;
  private eventType: EventType;
  private startTime: number;
  private startData: Record<string, unknown>;
  private ended = false;

  constructor(
    tracer: Tracer,
    eventType: EventType,
    parentSpanId?: string,
    data?: Record<string, unknown>
  ) {
    this.spanId = generateId();
    this.parentSpanId = parentSpanId;
    this.tracer = tracer;
    this.eventType = eventType;
    this.startTime = performance.now();
    this.startData = data ?? {};

    this.tracer.emit({
      eventType: this.eventType,
      traceId: this.tracer.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      timestamp: new Date(),
      data: this.startData,
    });
  }

  end(data?: Record<string, unknown>): void {
    if (this.ended) return;
    this.ended = true;
    const duration = (performance.now() - this.startTime) / 1000;
    this.tracer.emit({
      eventType: this.eventType,
      traceId: this.tracer.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      timestamp: new Date(),
      duration,
      data: { ...this.startData, ...data, phase: 'end' },
    });
    this.tracer.popSpan(this);
  }

  child(eventType: EventType, data?: Record<string, unknown>): Span {
    return new Span(this.tracer, eventType, this.spanId, data);
  }
}

export class Tracer {
  readonly traceId: string;
  private config: ObservabilityConfig;
  private spanStack: Span[] = [];
  private warnedTransports = new WeakSet<ITraceTransport>();

  constructor(config: ObservabilityConfig) {
    this.traceId = generateId();
    this.config = config;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  startSpan(eventType: EventType, data?: Record<string, unknown>): Span {
    const parentSpanId = this.spanStack.length > 0
      ? this.spanStack[this.spanStack.length - 1].spanId
      : undefined;
    const span = new Span(this, eventType, parentSpanId, data);
    this.spanStack.push(span);
    return span;
  }

  popSpan(span: Span): void {
    const idx = this.spanStack.lastIndexOf(span);
    if (idx !== -1) {
      this.spanStack.splice(idx, 1);
    }
  }

  emit(event: TraceEvent): void {
    if (!this.config.enabled) return;

    for (const transport of this.config.transports) {
      try {
        transport.emit(event);
      } catch (e) {
        if (!this.warnedTransports.has(transport)) {
          this.warnedTransports.add(transport);
          console.warn(`[OpenSymbolicAI] Trace transport error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.all(
      this.config.transports.map((t) => {
        try {
          return t.flush();
        } catch {
          return Promise.resolve();
        }
      })
    );
  }
}
