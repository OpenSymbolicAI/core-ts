import { LLM } from './base.js';
import type { LLMResponse } from './types.js';
import { toOllamaParams } from './types.js';

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Ollama LLM provider.
 *
 * Supports local models running via Ollama.
 */
export class OllamaLLM extends LLM {
  protected getDefaultBaseUrl(): string {
    return 'http://localhost:11434';
  }

  protected getEnvApiKey(): string | undefined {
    // Ollama doesn't require an API key for local use
    return undefined;
  }

  protected async generateImpl(prompt: string): Promise<LLMResponse> {
    const url = `${this.baseUrl}/api/generate`;

    const ollamaParams = toOllamaParams(this.config.params);

    const body: Record<string, unknown> = {
      model: this.config.model,
      prompt,
      stream: false,
      ...ollamaParams,
    };

    const response = await this.fetchJson<OllamaResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return {
      text: response.response,
      usage: {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
      },
      provider: 'ollama',
      model: response.model,
      raw: response,
    };
  }
}
