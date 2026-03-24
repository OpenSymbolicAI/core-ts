import { LLM } from './base.js';
import type { LLMResponse } from './types.js';
import { toOpenAIParams } from './types.js';

interface OpenAIMessage {
  role: string;
  content: string;
}

interface OpenAIChoice {
  message: OpenAIMessage;
  index: number;
  finish_reason: string;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

/**
 * OpenAI LLM provider.
 *
 * Supports GPT-4, GPT-3.5, and other OpenAI chat models.
 */
export class OpenAILLM extends LLM {
  protected getDefaultBaseUrl(): string {
    return 'https://api.openai.com/v1';
  }

  protected getEnvApiKey(): string | undefined {
    return globalThis.process?.env?.OPENAI_API_KEY;
  }

  protected async generateImpl(prompt: string): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      ...toOpenAIParams(this.config.params),
    };

    const response = await this.fetchJson<OpenAIResponse>(url, {
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
      provider: 'openai',
      model: response.model,
      raw: response,
    };
  }
}
