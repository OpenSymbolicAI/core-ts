import { LLM } from './base.js';
import type { LLMResponse } from './types.js';
import { toOpenAIParams } from './types.js';

interface FireworksMessage {
  role: string;
  content: string;
}

interface FireworksChoice {
  message: FireworksMessage;
  index: number;
  finish_reason: string;
}

interface FireworksUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface FireworksResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: FireworksChoice[];
  usage: FireworksUsage;
}

/**
 * Fireworks AI LLM provider.
 *
 * Uses OpenAI-compatible API format.
 */
export class FireworksLLM extends LLM {
  protected getDefaultBaseUrl(): string {
    return 'https://api.fireworks.ai/inference/v1';
  }

  protected getEnvApiKey(): string | undefined {
    return process.env.FIREWORKS_API_KEY;
  }

  protected async generateImpl(prompt: string): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      ...toOpenAIParams(this.config.params),
    };

    const response = await this.fetchJson<FireworksResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      usage: {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      },
      provider: 'fireworks',
      model: response.model,
      raw: response,
    };
  }
}
