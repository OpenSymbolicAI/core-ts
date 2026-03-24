import { LLM } from './base.js';
import type { LLMResponse } from './types.js';
import { toOpenAIParams } from './types.js';

interface GroqMessage {
  role: string;
  content: string;
}

interface GroqChoice {
  message: GroqMessage;
  index: number;
  finish_reason: string;
}

interface GroqUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  queue_time?: number;
  prompt_time?: number;
  completion_time?: number;
  total_time?: number;
}

interface GroqResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: GroqChoice[];
  usage: GroqUsage;
}

/**
 * Groq LLM provider.
 *
 * High-speed inference using OpenAI-compatible API format.
 */
export class GroqLLM extends LLM {
  protected getDefaultBaseUrl(): string {
    return 'https://api.groq.com/openai/v1';
  }

  protected getEnvApiKey(): string | undefined {
    return globalThis.process?.env?.GROQ_API_KEY;
  }

  protected async generateImpl(prompt: string): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      ...toOpenAIParams(this.config.params),
    };

    const response = await this.fetchJson<GroqResponse>(url, {
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
      provider: 'groq',
      model: response.model,
      raw: response,
    };
  }
}
