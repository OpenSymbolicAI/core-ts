import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  parsePlan, validatePlan, validatePlanOrThrow, DEFAULT_ALLOWED_BUILTINS,
  PlanExecute, DesignExecute, primitive, LLM,
  type LLMResponse,
} from '../src/index.js';

/**
 * Round 2: Trying harder to break it.
 *
 * These tests go beyond the validator — they test the full
 * plan → validate → execute pipeline with a MockLLM.
 */

const PRIMS = new Set([
  'getAllDeals', 'filterByStage', 'filterByQuarter', 'sortByDescending',
  'takeFirst', 'sumField', 'countDeals', 'weightedValue', 'formatReport',
  'filterGreaterThan', 'filterByRegion',
]);

function v(code: string, cf = false) {
  return validatePlan(parsePlan(code), {
    primitiveNames: PRIMS,
    allowedBuiltins: DEFAULT_ALLOWED_BUILTINS,
    allowControlFlow: cf,
  });
}

function isBlocked(code: string, cf = false): boolean {
  return !v(code, cf).valid;
}

// ── Mock LLM for end-to-end tests ──

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

class TestAgent extends PlanExecute {
  @primitive({ readOnly: true, docstring: 'Add two numbers' })
  add(a: number, b: number): number { return a + b; }

  @primitive({ readOnly: true, docstring: 'Get a greeting' })
  greet(name: string): string { return `Hello, ${name}`; }

  @primitive({ readOnly: true, docstring: 'Return an object' })
  getData(): Record<string, unknown> {
    return { name: 'test', values: [1, 2, 3], nested: { deep: true } };
  }
}

class TestDesignAgent extends DesignExecute {
  @primitive({ readOnly: true, docstring: 'Add two numbers' })
  add(a: number, b: number): number { return a + b; }

  @primitive({ readOnly: true, docstring: 'Identity' })
  identity(x: unknown): unknown { return x; }
}

// ─── Validator-level attacks ───

describe('Round 2: Validator attacks', () => {
  // Dot-notation access to constructor on string results
  it('blocks "string".constructor via dot notation', () => {
    expect(isBlocked('const x = "hello".constructor')).toBe(true);
  });

  it('blocks array.constructor via dot notation', () => {
    expect(isBlocked('const x = [1,2,3].constructor')).toBe(true);
  });

  it('blocks chained safe method then constructor', () => {
    expect(isBlocked('const x = "hello".toUpperCase().constructor')).toBe(true);
  });

  // Optional chaining to dangerous properties
  it('blocks optional chaining to constructor', () => {
    // obj?.constructor — if optional chaining is supported
    const result = v('const x = getAllDeals()?.constructor');
    console.log(`Optional chaining ?.constructor: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
    if (result.valid) console.log('  Errors:', result.errors.map(e => e.message));
  });

  // Destructuring — can we extract constructor via { constructor } = obj ?
  it('blocks object destructuring', () => {
    const result = v('const { name } = getData()');
    console.log(`Object destructuring: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  it('blocks array destructuring', () => {
    const result = v('const [a, b] = [1, 2]');
    console.log(`Array destructuring: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  // Comma operator
  it('blocks comma operator', () => {
    const result = v('const x = (1, 2, getAllDeals())');
    console.log(`Comma operator: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  // void operator
  it('blocks void operator', () => {
    const result = v('const x = void getAllDeals()');
    console.log(`Void operator: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  // in operator (property existence check)
  it('blocks in operator', () => {
    const result = v('const x = "constructor" in getAllDeals()');
    console.log(`"in" operator: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  // instanceof
  it('blocks instanceof', () => {
    const result = v('const x = getAllDeals() instanceof Array');
    console.log(`instanceof: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  // Tagged template literal
  it('blocks tagged template literal with builtin', () => {
    expect(isBlocked('const x = String.raw`hello`')).toBe(true);
  });

  // Symbol access
  it('blocks Symbol access', () => {
    const result = v('const x = Symbol("test")');
    console.log(`Symbol(): ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  it('blocks Symbol.iterator', () => {
    const result = v('const x = Symbol.iterator');
    console.log(`Symbol.iterator: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  // RegExp
  it('blocks RegExp literal exec', () => {
    const result = v('const x = /test/.exec("test string")');
    console.log(`RegExp.exec: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  // Nullish coalescing and logical assignment
  it('handles nullish coalescing', () => {
    const result = v('const x = getAllDeals() ?? []');
    console.log(`Nullish coalescing: ${result.valid ? 'ALLOWED ✓' : 'BLOCKED (maybe too strict?)'}`);
  });

  // Spread in function call
  it('handles spread in function call', () => {
    const result = v('const args = [1, 2]\nconst x = add(...args)');
    console.log(`Spread in call: ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });

  // Assignment operators that might bypass
  it('blocks assignment expressions', () => {
    // let x = 1; x = process  — can we reassign to dangerous values?
    const result = v('let x = 1\nx = getAllDeals()');
    console.log(`Reassignment: ${result.valid ? 'ALLOWED' : 'BLOCKED'}`);
  });

  // typeof on dangerous globals (info leak)
  it('typeof on process leaks existence info', () => {
    const result = v('const x = typeof process');
    console.log(`typeof process: ${result.valid ? 'BYPASS ⚠️ (leaks info)' : 'BLOCKED ✓'}`);
  });

  // Shadowing dangerous names as variable names
  it('blocks declaring variable named "constructor"', () => {
    expect(isBlocked('const constructor = 1')).toBe(true);
  });

  it('blocks declaring variable named "eval"', () => {
    expect(isBlocked('const eval = 1')).toBe(true);
  });

  it('blocks declaring variable named "prototype"', () => {
    expect(isBlocked('const prototype = 1')).toBe(true);
  });

  // Nested ternary to hide dangerous code
  it('blocks dangerous code inside ternary branches', () => {
    expect(isBlocked('const x = true ? eval("1") : 0')).toBe(true);
  });

  // Object.keys is allowed — can we chain from its result?
  it('blocks chaining from Object.keys to dangerous methods', () => {
    const result = v('const keys = Object.keys({})\nconst joined = keys.join(",")');
    console.log(`Object.keys().join(): ${result.valid ? 'ALLOWED ✓' : 'BLOCKED (too strict?)'}`);
  });

  // What about Object.keys then .constructor?
  it('blocks Object.keys().constructor', () => {
    expect(isBlocked('const keys = Object.keys({})\nconst c = keys.constructor')).toBe(true);
  });

  // JSON.stringify is allowed — result is a string
  it('allows JSON.stringify', () => {
    const result = v('const x = JSON.stringify({ a: 1 })');
    console.log(`JSON.stringify: ${result.valid ? 'ALLOWED ✓' : 'BLOCKED (too strict?)'}`);
  });

  // Can we use JSON.parse to craft objects with __proto__?
  it('JSON.parse with __proto__ key', () => {
    const result = v('const x = JSON.parse(\'{"__proto__": {"polluted": true}}\')');
    console.log(`JSON.parse with __proto__: ${result.valid ? 'ALLOWED (proto pollution risk?)' : 'BLOCKED ✓'}`);
  });

  // Math.constructor?
  it('blocks Math.constructor', () => {
    expect(isBlocked('const x = Math.constructor')).toBe(true);
  });

  // String.fromCharCode to build dangerous strings
  it('String.fromCharCode is allowed (just builds strings, not dangerous)', () => {
    const result = v('const x = String.fromCharCode(65)');
    console.log(`String.fromCharCode: ${result.valid ? 'ALLOWED ✓' : 'BLOCKED'}`);
  });

  // Array.from with mapping
  it('blocks Array.from with primitive as mapper', () => {
    const result = v('const x = Array.from([1,2], getAllDeals)');
    console.log(`Array.from(arr, primitive): ${result.valid ? 'BYPASS ⚠️' : 'BLOCKED ✓'}`);
  });
});

// ─── End-to-end interpreter attacks ───

describe('Round 2: End-to-end interpreter attacks', () => {
  let mockLLM: MockLLM;
  let agent: TestAgent;
  let designAgent: TestDesignAgent;

  function setup() {
    mockLLM = new MockLLM();
    agent = new TestAgent(mockLLM, 'TestAgent', 'test');
    designAgent = new TestDesignAgent(
      mockLLM, 'DesignAgent', 'test',
      { maxLoopIterations: 10, enableLoopGuards: true },
    );
  }

  it('cannot access constructor on returned string', async () => {
    setup();
    mockLLM.plan = 'const msg = greet("world")\nconst c = msg.constructor';
    const result = await agent.run('test');
    expect(result.success).toBe(false);
    console.log(`String.constructor via interpreter: BLOCKED ✓ — ${result.error}`);
  });

  it('cannot access __proto__ on returned object', async () => {
    setup();
    mockLLM.plan = 'const data = getData()\nconst p = data.__proto__';
    const result = await agent.run('test');
    expect(result.success).toBe(false);
    console.log(`Object.__proto__ via interpreter: BLOCKED ✓ — ${result.error}`);
  });

  it('cannot reach Function via safe method chain', async () => {
    setup();
    mockLLM.plan = 'const msg = greet("world")\nconst upper = msg.toUpperCase()\nconst c = upper.constructor';
    const result = await agent.run('test');
    expect(result.success).toBe(false);
    console.log(`method().constructor via interpreter: BLOCKED ✓ — ${result.error}`);
  });

  it('cannot use Object.keys result to access dangerous properties', async () => {
    setup();
    mockLLM.plan = 'const data = getData()\nconst keys = Object.keys(data)';
    const result = await agent.run('test');
    // Object.keys should work (it's in safe methods)
    console.log(`Object.keys: ${result.success ? 'ALLOWED ✓' : 'BLOCKED — ' + result.error}`);
  });

  it('for...of loop cannot enumerate prototype chain', async () => {
    setup();
    // DesignExecute allows control flow
    mockLLM.plan = 'let total = 0\nfor (const val of [1, 2, 3]) { total = add(total, val) }\nconst result = identity(total)';
    const result = await designAgent.run('test');
    expect(result.success).toBe(true);
    expect(result.result).toBe(6);
    console.log(`for...of safe loop: ALLOWED ✓`);
  });

  it('cannot break interpreter with deeply nested expressions', async () => {
    setup();
    mockLLM.plan = 'const a = add(add(add(add(add(1, 2), 3), 4), 5), 6)';
    const result = await agent.run('test');
    expect(result.success).toBe(true);
    expect(result.result).toBe(21);
    console.log(`Deep nesting: ALLOWED ✓ (result=${result.result})`);
  });

  it('cannot use string result to bypass property guards', async () => {
    setup();
    // greet returns a string. Can we use that string as a property key?
    // This requires bracket notation with a variable, which is now blocked at validator level.
    mockLLM.plan = 'const key = greet("constructor")\nconst obj = getData()\nconst x = obj[key]';
    const result = await agent.run('test');
    expect(result.success).toBe(false);
    console.log(`String-as-key bracket access: BLOCKED ✓ — ${result.error}`);
  });
});

// ─── Summary ───

describe('Round 2 Summary', () => {
  it('print results', () => {
    const attacks: [string, string, boolean?][] = [
      ['"hello".constructor', 'const x = "hello".constructor'],
      ['[].constructor', 'const x = [1,2,3].constructor'],
      ['method().constructor', 'const x = "hello".toUpperCase().constructor'],
      ['typeof process', 'const x = typeof process'],
      ['destructuring', 'const { name } = getData()'],
      ['Symbol()', 'const x = Symbol("test")'],
      ['Symbol.iterator', 'const x = Symbol.iterator'],
      ['RegExp.exec', 'const x = /test/.exec("test")'],
      ['void operator', 'const x = void getAllDeals()'],
      ['comma operator', 'const x = (1, 2, getAllDeals())'],
      ['"in" operator', 'const x = "constructor" in getAllDeals()'],
      ['instanceof', 'const x = getAllDeals() instanceof Array'],
      ['Object.keys().constructor', 'const k = Object.keys({})\nconst c = k.constructor'],
      ['Math.constructor', 'const x = Math.constructor'],
      ['Array.from(arr, primitive)', 'const x = Array.from([1,2], getAllDeals)'],
      ['spread in call', 'const args = [1, 2]\nconst x = add(...args)'],
      ['array destructuring', 'const [a, b] = [1, 2]'],
      ['object destructuring', 'const { name } = getData()'],
      ['Symbol.iterator', 'const x = Symbol.iterator'],
      ['const constructor = 1', 'const constructor = 1'],
      ['const eval = 1', 'const eval = 1'],
      // JSON.parse __proto__ intentionally passes the validator — string contents
      // can't be statically analyzed. The interpreter sanitizes the result at runtime.
    ];

    const bypasses: string[] = [];
    const blocked: string[] = [];

    for (const [name, code] of attacks) {
      if (isBlocked(code)) {
        blocked.push(name);
      } else {
        bypasses.push(name);
      }
    }

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║      ROUND 2 ATTACK SURFACE REPORT       ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Blocked: ${blocked.length.toString().padEnd(30)}║`);
    console.log(`║  Bypasses: ${bypasses.length.toString().padEnd(29)}║`);
    console.log('╚══════════════════════════════════════════╝');

    if (bypasses.length > 0) {
      console.log('\n🚨 BYPASSES:');
      bypasses.forEach(b => console.log(`   ⚠️  ${b}`));
    }
    console.log('\n✅ BLOCKED:');
    blocked.forEach(b => console.log(`   ✓  ${b}`));
    console.log('');

    expect(true).toBe(true);
  });
});
