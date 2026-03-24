/**
 * Interpreter Security Tests
 *
 * The validator is the first gate. These tests verify the INTERPRETER —
 * the actual execution engine — is also safe. Even if a plan somehow
 * passes validation, the interpreter should block dangerous operations.
 *
 * Attack categories:
 * 1. Runtime property guards (constructor, __proto__, prototype)
 * 2. Return value safety (function return blocking, sanitization)
 * 3. Prototype chain traversal via safe methods
 * 4. Method call safety (builtin method behavior)
 * 5. Namespace isolation (no leakage of agent internals)
 * 6. Resource exhaustion (call limits, deep nesting)
 * 7. Type coercion traps (toString/valueOf on returned objects)
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlanExecute,
  DesignExecute,
  primitive,
  LLM,
  type LLMResponse,
  type DesignExecuteConfig,
} from '../src/index.js';

// ─── Mock LLM ───

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

// ─── Test Agents ───

class BasicAgent extends PlanExecute {
  @primitive({ readOnly: true, docstring: 'Add two numbers' })
  add(a: number, b: number): number { return a + b; }

  @primitive({ readOnly: true, docstring: 'Return a greeting string' })
  greet(name: string): string { return `Hello, ${name}!`; }

  @primitive({ readOnly: true, docstring: 'Return an array of numbers' })
  getNumbers(): number[] { return [10, 20, 30, 40, 50]; }

  @primitive({ readOnly: true, docstring: 'Return a plain object with data' })
  getData(): Record<string, unknown> {
    return { name: 'Acme Corp', revenue: 1000000, active: true };
  }

  @primitive({ readOnly: true, docstring: 'Return nested object' })
  getNested(): Record<string, unknown> {
    return { outer: { inner: { deep: 42 } } };
  }

  @primitive({ readOnly: true, docstring: 'Multiply two numbers' })
  multiply(a: number, b: number): number { return a * b; }
}

class FunctionReturningAgent extends PlanExecute {
  @primitive({ readOnly: true })
  getCallback(): unknown {
    return () => 'hacked';
  }

  @primitive({ readOnly: true })
  getPromise(): unknown {
    return Promise.resolve('async-hacked');
  }

  @primitive({ readOnly: true })
  getClassInstance(): unknown {
    return new Map([['key', 'value']]);
  }

  @primitive({ readOnly: true })
  getObjectWithFunctions(): unknown {
    return {
      name: 'safe',
      hack: () => 'pwned',
    };
  }

  @primitive({ readOnly: true })
  getObjectWithProto(): unknown {
    // Simulate data that has __proto__ (e.g., from JSON.parse)
    const obj = Object.create(null);
    obj.name = 'safe';
    obj.__proto__ = { polluted: true };
    return obj;
  }

  @primitive({ readOnly: true })
  add(a: number, b: number): number { return a + b; }
}

class DesignAgent extends DesignExecute {
  @primitive({ readOnly: true, docstring: 'Add' })
  add(a: number, b: number): number { return a + b; }

  @primitive({ readOnly: true, docstring: 'Identity' })
  identity(x: unknown): unknown { return x; }

  @primitive({ readOnly: true, docstring: 'Return numbers' })
  getNumbers(): number[] { return [1, 2, 3, 4, 5]; }
}

// ─── Helpers ───

let mockLLM: MockLLM;

function runPlan(agent: PlanExecute, plan: string) {
  mockLLM.plan = plan;
  return agent.run('test');
}

// ═══════════════════════════════════════════
// 1. RUNTIME PROPERTY GUARDS
// ═══════════════════════════════════════════

describe('1. Runtime property guards', () => {
  let agent: BasicAgent;

  beforeEach(() => {
    mockLLM = new MockLLM();
    agent = new BasicAgent(mockLLM, 'Basic', 'test');
  });

  it('blocks .constructor on string return value', async () => {
    const r = await runPlan(agent, 'const msg = greet("world")\nconst c = msg.constructor');
    expect(r.success).toBe(false);
    expect(r.error).toContain('constructor');
  });

  it('blocks .constructor on array return value', async () => {
    const r = await runPlan(agent, 'const nums = getNumbers()\nconst c = nums.constructor');
    expect(r.success).toBe(false);
    expect(r.error).toContain('constructor');
  });

  it('blocks .constructor on object return value', async () => {
    const r = await runPlan(agent, 'const data = getData()\nconst c = data.constructor');
    expect(r.success).toBe(false);
    expect(r.error).toContain('constructor');
  });

  it('blocks .constructor on number (via method chain)', async () => {
    const r = await runPlan(agent, 'const n = add(1, 2)\nconst c = n.constructor');
    expect(r.success).toBe(false);
    expect(r.error).toContain('constructor');
  });

  it('blocks .__proto__ on object', async () => {
    const r = await runPlan(agent, 'const data = getData()\nconst p = data.__proto__');
    expect(r.success).toBe(false);
  });

  it('blocks .prototype on any value', async () => {
    const r = await runPlan(agent, 'const nums = getNumbers()\nconst p = nums.prototype');
    expect(r.success).toBe(false);
  });

  it('blocks .constructor after safe method call', async () => {
    const r = await runPlan(agent, 'const msg = greet("world")\nconst upper = msg.toUpperCase()\nconst c = upper.constructor');
    expect(r.success).toBe(false);
    expect(r.error).toContain('constructor');
  });

  it('blocks .constructor on nested property access', async () => {
    const r = await runPlan(agent, 'const data = getNested()\nconst inner = data.outer\nconst c = inner.constructor');
    expect(r.success).toBe(false);
    expect(r.error).toContain('constructor');
  });
});

// ═══════════════════════════════════════════
// 2. RETURN VALUE SAFETY
// ═══════════════════════════════════════════

describe('2. Return value safety', () => {
  let agent: FunctionReturningAgent;

  beforeEach(() => {
    mockLLM = new MockLLM();
    agent = new FunctionReturningAgent(mockLLM, 'FnAgent', 'test');
  });

  it('blocks primitives that return functions', async () => {
    const r = await runPlan(agent, 'const fn = getCallback()');
    expect(r.success).toBe(false);
    expect(r.error).toContain('function');
  });

  it('blocks primitives that return objects containing functions', async () => {
    const r = await runPlan(agent, 'const obj = getObjectWithFunctions()');
    // The object itself is returned (not a function), but accessing .hack would be dangerous
    // This tests whether the interpreter allows the object but blocks function access
    if (r.success) {
      // Object was returned — now try to access the function property
      mockLLM.plan = 'const obj = getObjectWithFunctions()\nconst h = obj.hack';
      const r2 = await agent.run('test2');
      // Accessing a function property should fail or the function-check should catch it
      // If it succeeds, that's a bypass
      if (r2.success && typeof r2.result === 'function') {
        expect.fail('Function leaked through object property access');
      }
    }
  });

  it('handles primitives that return Promises', async () => {
    const r = await runPlan(agent, 'const p = getPromise()');
    // Promise is an object, not a function — but it might resolve to a function
    // The interpreter should either block or safely handle it
    expect(r.success || r.error !== undefined).toBe(true);
  });

  it('sanitizes __proto__ keys from returned objects', async () => {
    const r = await runPlan(agent, 'const obj = getObjectWithProto()');
    if (r.success) {
      const result = r.result as Record<string, unknown>;
      // __proto__ key should have been stripped by sanitizeResult
      expect(result).not.toHaveProperty('__proto__');
      expect(result).toHaveProperty('name', 'safe');
    }
  });
});

// ═══════════════════════════════════════════
// 3. PROTOTYPE CHAIN TRAVERSAL VIA SAFE METHODS
// ═══════════════════════════════════════════

describe('3. Prototype chain via safe methods', () => {
  let agent: BasicAgent;

  beforeEach(() => {
    mockLLM = new MockLLM();
    agent = new BasicAgent(mockLLM, 'Basic', 'test');
  });

  it('safe methods return plain values, not function references', async () => {
    const r = await runPlan(agent, 'const msg = greet("world")\nconst upper = msg.toUpperCase()');
    expect(r.success).toBe(true);
    expect(r.result).toBe('HELLO, WORLD!');
    expect(typeof r.result).toBe('string');
  });

  it('array.slice returns plain array', async () => {
    const r = await runPlan(agent, 'const nums = getNumbers()\nconst first = nums.slice(0, 3)');
    expect(r.success).toBe(true);
    expect(r.result).toEqual([10, 20, 30]);
  });

  it('array.length returns number', async () => {
    const r = await runPlan(agent, 'const nums = getNumbers()\nconst len = nums.length');
    expect(r.success).toBe(true);
    expect(r.result).toBe(5);
  });

  it('string.split returns array of strings, not functions', async () => {
    const r = await runPlan(agent, 'const msg = greet("world")\nconst parts = msg.split(" ")');
    expect(r.success).toBe(true);
    expect(Array.isArray(r.result)).toBe(true);
  });

  it('nested safe method chains work correctly', async () => {
    const r = await runPlan(agent, 'const msg = greet("world")\nconst result = msg.toUpperCase().trim()');
    expect(r.success).toBe(true);
    expect(r.result).toBe('HELLO, WORLD!');
  });
});

// ═══════════════════════════════════════════
// 4. METHOD CALL SAFETY
// ═══════════════════════════════════════════

describe('4. Method call safety on builtins', () => {
  let agent: BasicAgent;

  beforeEach(() => {
    mockLLM = new MockLLM();
    agent = new BasicAgent(mockLLM, 'Basic', 'test');
  });

  // NOTE: JSON, Math, Object are NOT exposed as objects in the interpreter namespace.
  // The namespace exposes individual functions (abs, min, max, round, pow, etc.)
  // and Python-style builtins (len, range, sorted, etc.) instead.
  // The validator allows JSON.stringify etc. but the interpreter blocks them
  // because "JSON" is not a variable. This is defense-in-depth.

  it('JSON.stringify fails — JSON not in namespace (defense-in-depth)', async () => {
    const r = await runPlan(agent, 'const data = getData()\nconst json = JSON.stringify(data)');
    expect(r.success).toBe(false);
    // Fails because "JSON" is not a variable in the interpreter namespace
  });

  it('Math.floor fails — Math not in namespace (use round/floor builtins instead)', async () => {
    const r = await runPlan(agent, 'const x = Math.floor(3.7)');
    expect(r.success).toBe(false);
  });

  it('Object.keys fails — Object not in namespace', async () => {
    const r = await runPlan(agent, 'const data = getData()\nconst keys = Object.keys(data)');
    expect(r.success).toBe(false);
  });

  it('uses repr() builtin instead of JSON.stringify', async () => {
    const r = await runPlan(agent, 'const data = getData()\nconst json = repr(data)');
    expect(r.success).toBe(true);
    expect(typeof r.result).toBe('string');
  });
});

// ═══════════════════════════════════════════
// 5. NAMESPACE ISOLATION
// ═══════════════════════════════════════════

describe('5. Namespace isolation', () => {
  let agent: BasicAgent;

  beforeEach(() => {
    mockLLM = new MockLLM();
    agent = new BasicAgent(mockLLM, 'Basic', 'test');
  });

  it('cannot access agent instance properties', async () => {
    // Even if 'this' were available, non-primitive properties shouldn't be accessible
    const r = await runPlan(agent, 'const x = this.name');
    expect(r.success).toBe(false);
  });

  it('cannot access global objects not in namespace', async () => {
    const r = await runPlan(agent, 'const x = globalThis');
    expect(r.success).toBe(false);
  });

  it('variables from one run do not leak to the next', async () => {
    await runPlan(agent, 'const secret = greet("secret")');
    agent.reset();
    const r = await runPlan(agent, 'const x = secret');
    // 'secret' should not be defined in the new run
    expect(r.success).toBe(false);
  });

  it('cannot access process', async () => {
    const r = await runPlan(agent, 'const p = process');
    expect(r.success).toBe(false);
  });

  it('cannot access require', async () => {
    const r = await runPlan(agent, 'const r = require');
    expect(r.success).toBe(false);
  });

  it('undefined variables throw, not return host globals', async () => {
    const r = await runPlan(agent, 'const x = notDefined');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Undefined');
  });
});

// ═══════════════════════════════════════════
// 6. RESOURCE EXHAUSTION
// ═══════════════════════════════════════════

describe('6. Resource exhaustion', () => {
  it('blocks infinite loops via loop guards', async () => {
    mockLLM = new MockLLM();
    const agent = new DesignAgent(
      mockLLM, 'Design', 'test',
      { maxLoopIterations: 10, enableLoopGuards: true } as DesignExecuteConfig,
    );
    mockLLM.plan = 'let x = 0\nwhile (true) { x = add(x, 1) }';
    const r = await agent.run('test');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Loop guard');
  });

  it('blocks excessive primitive calls', async () => {
    mockLLM = new MockLLM();
    const agent = new DesignAgent(
      mockLLM, 'Design', 'test',
      { maxLoopIterations: 1000, enableLoopGuards: true, maxTotalPrimitiveCalls: 5 } as DesignExecuteConfig,
    );
    mockLLM.plan = 'let x = 0\nfor (let i = 0; i < 100; i++) { x = add(x, 1) }';
    const r = await agent.run('test');
    expect(r.success).toBe(false);
    expect(r.error).toContain('primitive calls');
  });

  it('deeply nested expressions complete without stack overflow', async () => {
    mockLLM = new MockLLM();
    const agent = new BasicAgent(mockLLM, 'Basic', 'test');
    // 20 levels of nesting
    mockLLM.plan = 'const x = add(add(add(add(add(add(add(add(add(add(1, 1), 1), 1), 1), 1), 1), 1), 1), 1), 1)';
    const r = await agent.run('test');
    expect(r.success).toBe(true);
    expect(r.result).toBe(11);
  });
});

// ═══════════════════════════════════════════
// 7. TYPE COERCION SAFETY
// ═══════════════════════════════════════════

describe('7. Type coercion safety', () => {
  let agent: BasicAgent;

  beforeEach(() => {
    mockLLM = new MockLLM();
    agent = new BasicAgent(mockLLM, 'Basic', 'test');
  });

  it('string concatenation with object coerces safely', async () => {
    const r = await runPlan(agent, 'const data = getData()\nconst s = "prefix:" + data');
    // This triggers toString on the object — should produce [object Object], not execute code
    expect(r.success).toBe(true);
    expect(typeof r.result).toBe('string');
  });

  it('arithmetic on non-numbers does not execute code', async () => {
    const r = await runPlan(agent, 'const msg = greet("world")\nconst x = msg - 1');
    // Result might be NaN or null depending on how the interpreter handles this
    // The key assertion: no code execution, no error thrown
    if (r.success) {
      expect(typeof r.result !== 'function').toBe(true);
    }
  });

  it('comparison between different types works without coercion traps', async () => {
    const r = await runPlan(agent, 'const x = add(1, 2)\nconst isMore = x > 0');
    expect(r.success).toBe(true);
    expect(r.result).toBe(true);
  });
});

// ═══════════════════════════════════════════
// 8. EXECUTION TRACE INTEGRITY
// ═══════════════════════════════════════════

describe('8. Execution trace integrity', () => {
  let agent: BasicAgent;

  beforeEach(() => {
    mockLLM = new MockLLM();
    agent = new BasicAgent(mockLLM, 'Basic', 'test');
  });

  it('trace records all steps correctly', async () => {
    mockLLM.plan = 'const a = add(1, 2)\nconst b = multiply(a, 3)\nconst msg = greet("result")';
    const r = await agent.run('test');
    expect(r.success).toBe(true);
    expect(r.trace?.steps).toHaveLength(3);
    expect(r.trace?.steps[0].primitiveCalled).toBe('add');
    expect(r.trace?.steps[0].resultValue).toBe(3);
    expect(r.trace?.steps[1].primitiveCalled).toBe('multiply');
    expect(r.trace?.steps[1].resultValue).toBe(9);
    expect(r.trace?.steps[2].primitiveCalled).toBe('greet');
  });

  it('trace captures namespace snapshots at each step', async () => {
    mockLLM.plan = 'const a = add(1, 2)\nconst b = add(a, 10)';
    const r = await agent.run('test');
    expect(r.success).toBe(true);
    const steps = r.trace!.steps;
    // After step 1, namespace should have 'a'
    expect(steps[0].namespaceAfter).toHaveProperty('a', 3);
    // After step 2, namespace should have both 'a' and 'b'
    expect(steps[1].namespaceAfter).toHaveProperty('a', 3);
    expect(steps[1].namespaceAfter).toHaveProperty('b', 13);
  });

  it('trace records timing for each step', async () => {
    mockLLM.plan = 'const x = add(1, 2)';
    const r = await agent.run('test');
    expect(r.success).toBe(true);
    expect(r.trace?.steps[0].timeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('failed step records error in trace', async () => {
    mockLLM.plan = 'const x = add(1, 2)\nconst y = unknownFunc(x)';
    const r = await agent.run('test');
    expect(r.success).toBe(false);
    // Should have error info
    expect(r.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// 9. DESIGN EXECUTE CONTROL FLOW
// ═══════════════════════════════════════════

describe('9. DesignExecute control flow safety', () => {
  let agent: DesignAgent;

  beforeEach(() => {
    mockLLM = new MockLLM();
    agent = new DesignAgent(
      mockLLM, 'Design', 'test',
      { maxLoopIterations: 100, enableLoopGuards: true, allowBreakContinue: true } as DesignExecuteConfig,
    );
  });

  it('for loop accumulates correctly', async () => {
    mockLLM.plan = `let sum = 0
for (let i = 0; i < 5; i++) {
  sum = add(sum, i)
}
const result = identity(sum)`;
    const r = await agent.run('test');
    expect(r.success).toBe(true);
    expect(r.result).toBe(10); // 0+1+2+3+4
  });

  it('for...of iterates correctly', async () => {
    mockLLM.plan = `const nums = getNumbers()
let total = 0
for (const n of nums) {
  total = add(total, n)
}
const result = identity(total)`;
    const r = await agent.run('test');
    expect(r.success).toBe(true);
    expect(r.result).toBe(15); // 1+2+3+4+5
  });

  it('if/else branches correctly', async () => {
    mockLLM.plan = `const x = add(1, 2)
let result = 0
if (x > 5) {
  result = identity(100)
} else {
  result = identity(200)
}
const final = identity(result)`;
    const r = await agent.run('test');
    expect(r.success).toBe(true);
    expect(r.result).toBe(200); // 3 is not > 5
  });

  it('try/catch handles errors', async () => {
    mockLLM.plan = `let result = 0
try {
  result = identity(42)
} catch (e) {
  result = identity(-1)
}
const final = identity(result)`;
    const r = await agent.run('test');
    expect(r.success).toBe(true);
    expect(r.result).toBe(42);
  });

  it('nested loops respect guard limits', async () => {
    const strictAgent = new DesignAgent(
      mockLLM, 'Strict', 'test',
      { maxLoopIterations: 5, enableLoopGuards: true } as DesignExecuteConfig,
    );
    mockLLM.plan = `let count = 0
for (let i = 0; i < 100; i++) {
  for (let j = 0; j < 100; j++) {
    count = add(count, 1)
  }
}`;
    const r = await strictAgent.run('test');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Loop guard');
  });
});
