/**
 * API key management for browser environments.
 */

/**
 * Provides API keys for LLM providers.
 * Framework-agnostic — usable in any browser or server context.
 */
export interface KeyProvider {
  /** Retrieve a key for the given provider. Returns null if unavailable. */
  getKey(provider: string): Promise<string | null> | string | null;
}

/**
 * Keys stored client-side in localStorage.
 *
 * The user manages their own keys. Zero backend required.
 * Suitable for personal tools, local development, single-user apps, and demos.
 */
export class LocalStorageKeyProvider implements KeyProvider {
  private prefix: string;

  constructor(prefix = 'osai_key_') {
    this.prefix = prefix;
  }

  getKey(provider: string): string | null {
    return localStorage.getItem(`${this.prefix}${provider}`);
  }

  setKey(provider: string, key: string): void {
    localStorage.setItem(`${this.prefix}${provider}`, key);
  }

  removeKey(provider: string): void {
    localStorage.removeItem(`${this.prefix}${provider}`);
  }

  hasKey(provider: string): boolean {
    return localStorage.getItem(`${this.prefix}${provider}`) !== null;
  }
}

/**
 * Backend key provider — keys never reach the browser.
 *
 * Used with ProxyLLM which routes calls through a backend that
 * attaches the LLM API key server-side.
 */
export class BackendKeyProvider implements KeyProvider {
  /**
   * Returns null — keys never reach the browser.
   * Used with ProxyLLM which routes calls through the backend.
   */
  getKey(_provider: string): null {
    return null;
  }
}
