/**
 * Sandbox Security Tests
 *
 * Attempts to break through the plan validator and interpreter sandbox.
 * Each test represents an attack vector that should be blocked.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlanExecute,
  DesignExecute,
  primitive,
  parsePlan,
  validatePlanOrThrow,
  DEFAULT_ALLOWED_BUILTINS,
  LLM,
  type LLMResponse,
  type DesignExecuteConfig,
} from '../src/index.js';

// ============================================================
// Test agents
// ============================================================

class MockLLM extends LLM {
  plan = '';
  constructor() { super({ provider: 'openai', model: 'mock' }); }
  protected async generateImpl(): Promise<LLMResponse> {
    return {
      text: '```typescript\n' + this.plan + '\n```',
      usage: { inputTokens: 0, outputTokens: 0 },
      provider: 'mock', model: 'mock',
    };
  }
  protected getDefaultBaseUrl(): string { return 'http://mock'; }
}

class SecureAgent extends PlanExecute {
  public secretKey = 'super-secret-api-key-12345';
  private internalState = { password: 'admin123' };

  @primitive({ readOnly: true, docstring: 'Add two numbers' })
  add(a: number, b: number): number { return a + b; }

  @primitive({ readOnly: true, docstring: 'Get a greeting' })
  greet(name: string): string { return `Hello, ${name}`; }

  @primitive({ readOnly: false, docstring: 'Store a value' })
  store(key: string, value: string): string { return `stored: ${key}=${value}`; }
}

class SecureDesignAgent extends DesignExecute {
  @primitive({ readOnly: true, docstring: 'Add two numbers' })
  add(a: number, b: number): number { return a + b; }

  @primitive({ readOnly: true, docstring: 'Identity function' })
  identity(x: unknown): unknown { return x; }
}

function validate(code: string, opts?: { allowControlFlow?: boolean; allowBreakContinue?: boolean }) {
  const sf = parsePlan(code);
  const primitiveNames = new Set(['add', 'greet', 'store', 'identity']);
  validatePlanOrThrow(sf, {
    primitiveNames,
    allowedBuiltins: DEFAULT_ALLOWED_BUILTINS,
    allowSelfCalls: true,
    allowControlFlow: opts?.allowControlFlow ?? false,
    allowBreakContinue: opts?.allowBreakContinue ?? false,
  });
}

function expectBlocked(code: string, opts?: { allowControlFlow?: boolean; allowBreakContinue?: boolean }) {
  expect(() => validate(code, opts)).toThrow();
}

function expectAllowed(code: string, opts?: { allowControlFlow?: boolean; allowBreakContinue?: boolean }) {
  expect(() => validate(code, opts)).not.toThrow();
}

// ============================================================
// Tests
// ============================================================

describe('Sandbox Security', () => {
  let mockLLM: MockLLM;
  let agent: SecureAgent;

  beforeEach(() => {
    mockLLM = new MockLLM();
    agent = new SecureAgent(mockLLM, 'SecureAgent', 'test agent');
  });

  // ==== 1. File System Access ====
  describe('File System Access', () => {
    it('should block require("fs")', () => {
      expectBlocked('const fs = require("fs")');
    });

    it('should block import statements', () => {
      expectBlocked('import fs from "fs"');
    });

    it('should block dynamic import()', () => {
      expectBlocked('const fs = import("fs")');
    });

    it('should block process.env access', () => {
      expectBlocked('const key = process.env.SECRET');
    });

    it('should block __dirname', () => {
      expectBlocked('const dir = __dirname');
    });

    it('should block __filename', () => {
      expectBlocked('const f = __filename');
    });
  });

  // ==== 2. Code Execution ====
  describe('Code Execution', () => {
    it('should block eval()', () => {
      expectBlocked('const x = eval("1+1")');
    });

    it('should block Function constructor', () => {
      expectBlocked('const fn = Function("return 1")');
    });

    it('should block setTimeout', () => {
      expectBlocked('const t = setTimeout(() => {}, 0)');
    });

    it('should block setInterval', () => {
      expectBlocked('const t = setInterval(() => {}, 0)');
    });

    it('should block arrow functions', () => {
      expectBlocked('const fn = () => 1');
    });

    it('should block function expressions', () => {
      expectBlocked('const fn = function() { return 1 }');
    });

    it('should block function declarations', () => {
      expectBlocked('function hack() { return 1 }');
    });
  });

  // ==== 3. Object Construction ====
  describe('Object Construction', () => {
    it('should block new expressions', () => {
      expectBlocked('const x = new Map()');
    });

    it('should block new Error', () => {
      expectBlocked('const e = new Error("boom")');
    });

    it('should block new Proxy', () => {
      expectBlocked('const p = new Proxy({}, {})');
    });
  });

  // ==== 4. Reflection & Introspection ====
  describe('Reflection & Introspection', () => {
    it('should block Reflect access', () => {
      expectBlocked('const x = Reflect.get({}, "a")');
    });

    it('should block Proxy access', () => {
      expectBlocked('const x = Proxy');
    });

    it('should block constructor access', () => {
      expectBlocked('const c = constructor');
    });

    it('should block __proto__ access', () => {
      expectBlocked('const p = __proto__');
    });

    it('should block prototype access on objects', () => {
      expectBlocked('const x = add.prototype');
    });

    it('should block instanceof in interpreter', async () => {
      // instanceof is parsed fine but the interpreter should block it
      mockLLM.plan = 'const x = add(1, 2)\nconst check = x instanceof Object';
      // The validator may or may not block this, but the interpreter should
      const result = await agent.run('test');
      // Either validation or execution should fail
      expect(result.success).toBe(false);
    });
  });

  // ==== 5. Private Member Access ====
  describe('Private Member Access', () => {
    it('should block double-underscore names', () => {
      expectBlocked('const x = __secret');
    });

    it('should block private property access', () => {
      expectBlocked('const x = obj._private');
    });

    it('should block private method calls', () => {
      expectBlocked('const x = _privateMethod(1)');
    });
  });

  // ==== 6. Declaration Attacks ====
  describe('Declaration Attacks', () => {
    it('should block class declarations', () => {
      expectBlocked('class Evil { hack() {} }');
    });

    it('should block interface declarations', () => {
      expectBlocked('interface Hack { x: string }');
    });

    it('should block type alias declarations', () => {
      expectBlocked('type Evil = string');
    });

    it('should block enum declarations', () => {
      expectBlocked('enum Dir { Up, Down }');
    });

    it('should block export declarations', () => {
      expectBlocked('export const x = 1');
    });
  });

  // ==== 7. Control Flow in PlanExecute ====
  describe('Control Flow Blocked in PlanExecute', () => {
    it('should block for loops', () => {
      expectBlocked('for (let i = 0; i < 10; i++) {}');
    });

    it('should block while loops', () => {
      expectBlocked('while (true) {}');
    });

    it('should block if statements', () => {
      expectBlocked('if (true) { const x = add(1, 2) }');
    });

    it('should block for...of loops', () => {
      expectBlocked('for (const x of [1,2,3]) {}');
    });

    it('should block try/catch', () => {
      expectBlocked('try { add(1,2) } catch(e) {}');
    });

    it('should allow control flow in DesignExecute', () => {
      const designOpts = { allowControlFlow: true };
      expectAllowed('for (let i = 0; i < 10; i++) {}', designOpts);
      expectAllowed('if (true) { const x = add(1, 2) }', designOpts);
    });

    it('should block break/continue without allowBreakContinue', () => {
      expectBlocked('while (true) { break }', { allowControlFlow: true });
    });
  });

  // ==== 8. Dangerous Globals ====
  describe('Dangerous Globals', () => {
    it('should block fetch', () => {
      expectBlocked('const r = fetch("http://evil.com")');
    });

    it('should block XMLHttpRequest', () => {
      expectBlocked('const x = XMLHttpRequest');
    });

    it('should block document', () => {
      expectBlocked('const d = document');
    });

    it('should block window', () => {
      expectBlocked('const w = window');
    });

    it('should block location', () => {
      expectBlocked('const l = location');
    });
  });

  // ==== 9. Agent Internal State Access ====
  describe('Agent Internal State Access', () => {
    it('should not leak agent secretKey through plan execution', async () => {
      // Try to access this.secretKey via a plan
      mockLLM.plan = 'const key = this.secretKey';
      const result = await agent.run('test');
      // Validator should block this - secretKey is not a primitive
      // Even if it gets through, the namespace should not expose it
      if (result.success) {
        expect(result.result).not.toBe('super-secret-api-key-12345');
      }
    });

    it('should not access agent config through this', async () => {
      mockLLM.plan = 'const cfg = this.config';
      const result = await agent.run('test');
      if (result.success) {
        expect(result.result).not.toHaveProperty('onMutation');
      }
    });

    it('should not access agent llm through this', async () => {
      mockLLM.plan = 'const l = this.llm';
      const result = await agent.run('test');
      if (result.success) {
        expect(result.result).toBeUndefined();
      }
    });
  });

  // ==== 10. Prototype Pollution ====
  describe('Prototype Pollution', () => {
    it('should block __proto__ property access', () => {
      expectBlocked('const x = add.__proto__');
    });

    it('should block constructor property access', () => {
      expectBlocked('const x = add.constructor');
    });

    it('should block delete expressions', () => {
      expectBlocked('const x = delete Object.prototype');
    });
  });

  // ==== 11. Obfuscation Attempts ====
  describe('Obfuscation Attempts', () => {
    it('string concatenation producing "eval" is just a string, not dangerous', () => {
      // "ev" + "al" produces the string "eval", not a reference to eval()
      // This is safe — the result is data, not code
      expectAllowed('const e = "ev" + "al"');
    });

    it('should block computed property access on globals', () => {
      // this["eval"] style - bracket access
      expectBlocked('const x = this["eval"]');
    });

    it('should block tagged template literals', () => {
      expectBlocked('const x = eval`1+1`');
    });
  });

  // ==== 12. Return Function Attacks ====
  describe('Return Function Prevention', () => {
    it('should reject primitives that return functions', async () => {
      // The interpreter has a safety check for this
      class EvilAgent extends PlanExecute {
        @primitive({ readOnly: true })
        getCallback(): () => void {
          return () => console.log('hacked');
        }
      }
      const evil = new EvilAgent(mockLLM, 'Evil', 'evil');
      mockLLM.plan = 'const fn = getCallback()';
      const result = await evil.run('test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('function');
    });
  });

  // ==== 13. Variable Name Attacks ====
  describe('Variable Name Attacks', () => {
    it('should block assigning to "this"', () => {
      expectBlocked('const this = 1');
    });

    it('should block assigning to "undefined"', () => {
      // TS parser handles this differently, but validator should catch it
      expectBlocked('const undefined = 1');
    });

    it('should block double-underscore variable names', () => {
      expectBlocked('const __exploit = add(1, 2)');
    });
  });

  // ==== 14. Safe Operations (should NOT be blocked) ====
  describe('Safe Operations', () => {
    it('should allow primitive calls', () => {
      expectAllowed('const x = add(1, 2)');
    });

    it('should allow chained primitive calls', () => {
      expectAllowed('const a = add(1, 2)\nconst b = add(a, 3)');
    });

    it('should allow string literals', () => {
      expectAllowed('const name = greet("world")');
    });

    it('should allow array literals', () => {
      expectAllowed('const arr = [1, 2, 3]');
    });

    it('should allow object literals', () => {
      expectAllowed('const obj = { a: 1, b: 2 }');
    });

    it('should allow template literals', () => {
      expectAllowed('const msg = `hello ${greet("world")}`');
    });

    it('should allow ternary expressions', () => {
      expectAllowed('const x = true ? add(1, 2) : add(3, 4)');
    });

    it('should allow safe instance methods on results', () => {
      expectAllowed('const x = greet("world").toUpperCase()');
    });

    it('should allow typeof', () => {
      expectAllowed('const t = typeof add(1, 2)');
    });

    it('should allow comments', () => {
      expectAllowed('// this is a comment\nconst x = add(1, 2)');
    });

    it('should allow numeric operations', () => {
      expectAllowed('const x = add(1, 2)\nconst y = x + 3');
    });

    it('should allow comparisons', () => {
      expectAllowed('const x = add(1, 2)\nconst isPositive = x > 0');
    });
  });

  // ==== 15. Loop Guard Tests (DesignExecute) ====
  describe('Loop Guards', () => {
    let designLLM: MockLLM;
    let designAgent: SecureDesignAgent;

    beforeEach(() => {
      designLLM = new MockLLM();
      designAgent = new SecureDesignAgent(
        designLLM, 'DesignAgent', 'test',
        { maxLoopIterations: 5, enableLoopGuards: true } as DesignExecuteConfig
      );
    });

    it('should terminate infinite while loops', async () => {
      designLLM.plan = 'let x = 0\nwhile (true) { x = add(x, 1) }';
      const result = await designAgent.run('test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Loop guard');
    });

    it('should terminate infinite for loops', async () => {
      designLLM.plan = 'let x = 0\nfor (;;) { x = add(x, 1) }';
      const result = await designAgent.run('test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Loop guard');
    });

    it('should allow loops within the iteration limit', async () => {
      designLLM.plan = 'let x = 0\nfor (let i = 0; i < 3; i++) { x = add(x, 1) }\nconst result = identity(x)';
      const result = await designAgent.run('test');
      expect(result.success).toBe(true);
      expect(result.result).toBe(3);
    });
  });

  // ==== 16. End-to-End Attack Scenarios ====
  describe('End-to-End Attacks', () => {
    it('should block environment variable exfiltration', async () => {
      mockLLM.plan = 'const key = process.env.OPENAI_API_KEY';
      const result = await agent.run('test');
      expect(result.success).toBe(false);
    });

    it('should block prototype chain walking', async () => {
      mockLLM.plan = 'const proto = add.__proto__.__proto__';
      const result = await agent.run('test');
      expect(result.success).toBe(false);
    });

    it('should block globalThis access', async () => {
      mockLLM.plan = 'const g = globalThis';
      const result = await agent.run('test');
      expect(result.success).toBe(false);
    });

    it('should block process.exit', async () => {
      mockLLM.plan = 'const x = process.exit(1)';
      const result = await agent.run('test');
      expect(result.success).toBe(false);
    });

    it('should handle unknown function calls gracefully', async () => {
      mockLLM.plan = 'const x = hackTheSystem()';
      const result = await agent.run('test');
      expect(result.success).toBe(false);
    });

    it('should prevent mutation without approval', async () => {
      const guarded = new SecureAgent(mockLLM, 'Guarded', 'test', {
        onMutation: () => 'blocked by policy',
      });
      mockLLM.plan = 'const x = store("key", "value")';
      const result = await guarded.run('test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('rejected');
    });
  });
});
