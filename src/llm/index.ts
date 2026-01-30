/**
 * LLM abstraction layer for OpenSymbolicAI.
 *
 * Provides a unified interface for multiple LLM providers.
 */

export { LLM } from './base.js';
export { OpenAILLM } from './openai.js';
export { AnthropicLLM } from './anthropic.js';
export { OllamaLLM } from './ollama.js';
export { FireworksLLM } from './fireworks.js';
export { GroqLLM } from './groq.js';
export { InMemoryCache, NullCache, computeCacheKey } from './cache.js';
export type {
  Provider,
  GenerationParams,
  LLMConfig,
  LLMResponse,
  LLMCache,
  LLMCacheEntry,
} from './types.js';
export {
  ProviderSchema,
  GenerationParamsSchema,
  LLMConfigSchema,
  toOpenAIParams,
  toAnthropicParams,
  toOllamaParams,
} from './types.js';

import { LLM } from './base.js';
import { OpenAILLM } from './openai.js';
import { AnthropicLLM } from './anthropic.js';
import { OllamaLLM } from './ollama.js';
import { FireworksLLM } from './fireworks.js';
import { GroqLLM } from './groq.js';
import type { LLMCache, LLMConfig, Provider } from './types.js';

/**
 * Map of provider names to LLM classes.
 */
const PROVIDER_MAP: Record<
  Provider,
  new (config: LLMConfig, cache?: LLMCache) => LLM
> = {
  openai: OpenAILLM,
  anthropic: AnthropicLLM,
  ollama: OllamaLLM,
  fireworks: FireworksLLM,
  groq: GroqLLM,
};

/**
 * Create an LLM instance from a configuration.
 *
 * @param config - LLM configuration specifying provider, model, etc.
 * @param cache - Optional cache for response caching
 * @returns Configured LLM instance
 *
 * @example
 * ```typescript
 * const llm = createLLM({
 *   provider: 'openai',
 *   model: 'gpt-4',
 *   params: { temperature: 0 }
 * });
 *
 * const response = await llm.generate('Hello, world!');
 * console.log(response.text);
 * ```
 */
export function createLLM(config: LLMConfig, cache?: LLMCache): LLM {
  const LLMClass = PROVIDER_MAP[config.provider];
  if (!LLMClass) {
    throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
  return new LLMClass(config, cache);
}

/**
 * Check if a value is an LLM instance.
 */
export function isLLM(value: unknown): value is LLM {
  return value instanceof LLM;
}
