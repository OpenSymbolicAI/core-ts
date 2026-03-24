/**
 * Convenience factory for creating LLM instances in browser environments.
 */

import { createLLM } from '../llm/index.js';
import type { LLMConfig } from '../llm/types.js';
import type { KeyProvider } from './key-provider.js';
import { LocalStorageKeyProvider } from './key-provider.js';
import { ProxyLLM } from './proxy-llm.js';

export interface BrowserLLMOptions {
  keyProvider?: KeyProvider;
  proxyUrl?: string;
  sessionToken?: string;
}

/**
 * Create an LLM instance configured for browser use.
 *
 * Supports two modes:
 * - **Direct mode**: Browser calls provider API with a key from KeyProvider
 * - **Proxy mode**: Routes calls through your backend (for managed keys)
 *
 * @example Direct mode (localStorage keys)
 * ```typescript
 * const llm = await createBrowserLLM({
 *   provider: 'openai',
 *   model: 'gpt-4',
 *   params: { temperature: 0 },
 * });
 * ```
 *
 * @example Proxy mode (backend-managed keys)
 * ```typescript
 * const llm = await createBrowserLLM(
 *   { provider: 'anthropic', model: 'claude-sonnet-4-6', params: {} },
 *   { proxyUrl: '/api/llm', sessionToken: auth.getToken() }
 * );
 * ```
 */
export async function createBrowserLLM(
  config: LLMConfig,
  options?: BrowserLLMOptions
) {
  const provider = options?.keyProvider ?? new LocalStorageKeyProvider();
  const key = await provider.getKey(config.provider);

  if (key) {
    // Direct mode — browser calls provider API
    return createLLM({ ...config, apiKey: key });
  }

  if (options?.proxyUrl) {
    // Proxy mode — route through backend
    return new ProxyLLM(config, options.proxyUrl, options.sessionToken ?? '');
  }

  throw new Error(
    `No API key found for provider "${config.provider}" and no proxy configured. ` +
    `Either store a key via KeyProvider or provide a proxyUrl.`
  );
}
