import { LLMError } from '../exceptions.js';
import { computeCacheKey } from './cache.js';
import type { LLMCache, LLMConfig, LLMResponse } from './types.js';

/**
 * Abstract base class for LLM providers.
 *
 * Handles caching and common functionality, delegating actual generation
 * to provider-specific implementations.
 */
export abstract class LLM {
  protected config: LLMConfig;
  protected cache?: LLMCache;

  constructor(config: LLMConfig, cache?: LLMCache) {
    this.config = config;
    this.cache = cache;
  }

  /**
   * Generate a response from the LLM.
   *
   * Checks the cache first, then calls the provider implementation.
   */
  async generate(prompt: string): Promise<LLMResponse> {
    // Check cache first
    if (this.cache) {
      const cacheKey = await computeCacheKey(this.config, prompt);
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Generate response
    const response = await this.generateImpl(prompt);

    // Cache the response
    if (this.cache) {
      const cacheKey = await computeCacheKey(this.config, prompt);
      await this.cache.set(cacheKey, response);
    }

    return response;
  }

  /**
   * Provider-specific implementation of generation.
   */
  protected abstract generateImpl(prompt: string): Promise<LLMResponse>;

  /**
   * Get the provider name.
   */
  get provider(): string {
    return this.config.provider;
  }

  /**
   * Get the model name.
   */
  get model(): string {
    return this.config.model;
  }

  /**
   * Get the API key (falls back to environment variable).
   */
  protected get apiKey(): string | undefined {
    return this.config.apiKey || this.getEnvApiKey();
  }

  /**
   * Get the API key from environment variables.
   * Override in subclasses for provider-specific env var names.
   */
  protected getEnvApiKey(): string | undefined {
    return undefined;
  }

  /**
   * Get the base URL for API calls.
   */
  protected get baseUrl(): string {
    return this.config.baseUrl || this.getDefaultBaseUrl();
  }

  /**
   * Get the default base URL for this provider.
   */
  protected abstract getDefaultBaseUrl(): string;

  /**
   * Make an HTTP request with error handling.
   */
  protected async fetchJson<T>(
    url: string,
    options: RequestInit
  ): Promise<T> {
    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new LLMError(
          `API request failed: ${response.status} ${response.statusText}: ${errorText}`,
          this.config.provider,
          this.config.model,
          response.status
        );
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof LLMError) {
        throw error;
      }

      throw new LLMError(
        `Network error: ${error instanceof Error ? error.message : String(error)}`,
        this.config.provider,
        this.config.model
      );
    }
  }
}
