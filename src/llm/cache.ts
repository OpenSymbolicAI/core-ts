import type { LLMCache, LLMCacheEntry, LLMConfig, LLMResponse } from './types.js';

/**
 * Compute a cache key from config and prompt.
 * Uses SHA-256 hash via Web Crypto API (works in browsers and Node 18+).
 */
export async function computeCacheKey(config: LLMConfig, prompt: string): Promise<string> {
  const keyData = {
    provider: config.provider,
    model: config.model,
    prompt,
    params: config.params,
  };

  const json = JSON.stringify(keyData, Object.keys(keyData).sort());
  const data = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * In-memory LLM response cache.
 *
 * Simple dictionary-based cache with optional max size and LRU eviction.
 */
export class InMemoryCache implements LLMCache {
  private cache: Map<string, LLMCacheEntry> = new Map();
  private accessOrder: string[] = [];
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  async get(key: string): Promise<LLMResponse | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      return null;
    }

    // Update access order for LRU
    this.updateAccessOrder(key);

    return entry.response;
  }

  async set(key: string, response: LLMResponse, ttlMs?: number): Promise<void> {
    // Evict if necessary
    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const entry: LLMCacheEntry = {
      response,
      timestamp: new Date(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs) : undefined,
    };

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    this.removeFromAccessOrder(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get the current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;

    const lruKey = this.accessOrder.shift()!;
    this.cache.delete(lruKey);
  }
}

/**
 * Null cache that doesn't cache anything.
 * Useful for testing or when caching is explicitly disabled.
 */
export class NullCache implements LLMCache {
  async get(_key: string): Promise<LLMResponse | null> {
    return null;
  }

  async set(_key: string, _response: LLMResponse, _ttlMs?: number): Promise<void> {
    // No-op
  }

  async delete(_key: string): Promise<void> {
    // No-op
  }

  async clear(): Promise<void> {
    // No-op
  }
}
