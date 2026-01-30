import { LLM } from './base.js';
import type { LLMResponse } from './types.js';
import { toAnthropicParams } from './types.js';

interface AnthropicContent {
  type: string;
  text?: string;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContent[];
  model: string;
  stop_reason: string;
  usage: AnthropicUsage;
}

/**
 * Anthropic LLM provider.
 *
 * Supports Claude 3, Claude 2, and other Anthropic models.
 */
export class AnthropicLLM extends LLM {
  protected getDefaultBaseUrl(): string {
    return 'https://api.anthropic.com';
  }

  protected getEnvApiKey(): string | undefined {
    return process.env.ANTHROPIC_API_KEY;
  }

  protected async generateImpl(prompt: string): Promise<LLMResponse> {
    const url = `${this.baseUrl}/v1/messages`;

    // Anthropic requires max_tokens to be set
    const params = toAnthropicParams(this.config.params);
    if (!params.max_tokens) {
      params.max_tokens = 4096;
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      ...params,
    };

    const response = await this.fetchJson<AnthropicResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    // Extract text from content blocks
    const text = response.content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('');

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      provider: 'anthropic',
      model: response.model,
      raw: response,
    };
  }
}
