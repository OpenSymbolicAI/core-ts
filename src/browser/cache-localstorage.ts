/**
 * localStorage-backed LLM response cache for browser environments.
 *
 * Lighter alternative to InMemoryCache that survives page refreshes.
 * Evicts oldest entries when maxEntries is exceeded.
 */

import type { LLMCache, LLMResponse } from '../llm/types.js';

export class LocalStorageCache implements LLMCache {
  private prefix: string;
  private maxEntries: number;

  constructor(prefix = 'osai_cache_', maxEntries = 200) {
    this.prefix = prefix;
    this.maxEntries = maxEntries;
  }

  async get(key: string): Promise<LLMResponse | null> {
    const raw = localStorage.getItem(`${this.prefix}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
      localStorage.removeItem(`${this.prefix}${key}`);
      return null;
    }
    return entry.response;
  }

  async set(key: string, response: LLMResponse, ttlMs?: number): Promise<void> {
    this.evictIfNeeded();

    const entry = {
      response,
      timestamp: new Date().toISOString(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : undefined,
    };
    localStorage.setItem(`${this.prefix}${key}`, JSON.stringify(entry));
  }

  async delete(key: string): Promise<void> {
    localStorage.removeItem(`${this.prefix}${key}`);
  }

  async clear(): Promise<void> {
    for (const key of this.getCacheKeys()) {
      localStorage.removeItem(key);
    }
  }

  private getCacheKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }

  private evictIfNeeded(): void {
    const keys = this.getCacheKeys();
    if (keys.length < this.maxEntries) return;

    // Sort by timestamp ascending (oldest first) and evict
    const entries = keys.map(key => {
      const raw = localStorage.getItem(key);
      const timestamp = raw ? JSON.parse(raw).timestamp ?? '' : '';
      return { key, timestamp };
    });
    entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const toEvict = entries.length - this.maxEntries + 1;
    for (let i = 0; i < toEvict; i++) {
      localStorage.removeItem(entries[i].key);
    }
  }
}
