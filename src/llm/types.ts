import { z } from 'zod';
import { TokenUsage } from '../models.js';

/**
 * Supported LLM providers.
 */
export const ProviderSchema = z.enum([
  'openai',
  'anthropic',
  'ollama',
  'fireworks',
  'groq',
]);
export type Provider = z.infer<typeof ProviderSchema>;

/**
 * Generation parameters (provider-agnostic).
 */
export const GenerationParamsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  stop: z.array(z.string()).optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  seed: z.number().int().optional(),
});
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;

/**
 * LLM configuration.
 */
export const LLMConfigSchema = z.object({
  provider: ProviderSchema,
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  params: GenerationParamsSchema.default({}),
});
export type LLMConfig = z.infer<typeof LLMConfigSchema>;

/**
 * Response from an LLM generation call.
 */
export interface LLMResponse {
  text: string;
  usage: TokenUsage;
  provider: string;
  model: string;
  raw?: unknown;
}

/**
 * Cache entry for LLM responses.
 */
export interface LLMCacheEntry {
  response: LLMResponse;
  timestamp: Date;
  expiresAt?: Date;
}

/**
 * Interface for LLM response caching.
 */
export interface LLMCache {
  /**
   * Get a cached response by key.
   */
  get(key: string): Promise<LLMResponse | null>;

  /**
   * Store a response in the cache.
   */
  set(key: string, response: LLMResponse, ttlMs?: number): Promise<void>;

  /**
   * Delete a cached entry.
   */
  delete(key: string): Promise<void>;

  /**
   * Clear all cached entries.
   */
  clear(): Promise<void>;
}

/**
 * Convert GenerationParams to provider-specific API format.
 */
export function toOpenAIParams(params: GenerationParams): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (params.temperature !== undefined) result.temperature = params.temperature;
  if (params.topP !== undefined) result.top_p = params.topP;
  if (params.maxTokens !== undefined) result.max_tokens = params.maxTokens;
  if (params.stop !== undefined) result.stop = params.stop;
  if (params.frequencyPenalty !== undefined) result.frequency_penalty = params.frequencyPenalty;
  if (params.presencePenalty !== undefined) result.presence_penalty = params.presencePenalty;
  if (params.seed !== undefined) result.seed = params.seed;

  return result;
}

/**
 * Convert GenerationParams to Anthropic API format.
 */
export function toAnthropicParams(params: GenerationParams): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (params.temperature !== undefined) result.temperature = params.temperature;
  if (params.topP !== undefined) result.top_p = params.topP;
  if (params.topK !== undefined) result.top_k = params.topK;
  if (params.maxTokens !== undefined) result.max_tokens = params.maxTokens;
  if (params.stop !== undefined) result.stop_sequences = params.stop;

  return result;
}

/**
 * Convert GenerationParams to Ollama API format.
 */
export function toOllamaParams(params: GenerationParams): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  if (params.temperature !== undefined) options.temperature = params.temperature;
  if (params.topP !== undefined) options.top_p = params.topP;
  if (params.topK !== undefined) options.top_k = params.topK;
  if (params.stop !== undefined) options.stop = params.stop;
  if (params.seed !== undefined) options.seed = params.seed;

  const result: Record<string, unknown> = { options };
  if (params.maxTokens !== undefined) {
    (result.options as Record<string, unknown>).num_predict = params.maxTokens;
  }

  return result;
}
