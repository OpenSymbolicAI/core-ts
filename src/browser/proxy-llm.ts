/**
 * ProxyLLM — routes LLM calls through a backend proxy.
 *
 * Used in browser environments where API keys stay server-side.
 * The browser authenticates to your backend, which attaches the
 * LLM API key and forwards to the provider.
 */

import { LLM } from '../llm/base.js';
import type { LLMCache, LLMConfig, LLMResponse } from '../llm/types.js';

export class ProxyLLM extends LLM {
  private proxyUrl: string;
  private sessionToken: string;

  constructor(config: LLMConfig, proxyUrl: string, sessionToken: string, cache?: LLMCache) {
    super(config, cache);
    this.proxyUrl = proxyUrl;
    this.sessionToken = sessionToken;
  }

  protected getDefaultBaseUrl(): string {
    return this.proxyUrl;
  }

  protected async generateImpl(prompt: string): Promise<LLMResponse> {
    return this.fetchJson(`${this.proxyUrl}/v1/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.sessionToken}`,
      },
      body: JSON.stringify({
        provider: this.config.provider,
        model: this.config.model,
        prompt,
        params: this.config.params,
      }),
    });
  }
}
