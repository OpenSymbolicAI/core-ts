import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { parsePlan, validatePlan, DEFAULT_ALLOWED_BUILTINS } from '../src/index.js';

/**
 * Advanced attack tests inspired by real CVEs.
 * These test whether the validator CORRECTLY blocks each attack.
 * Tests marked "BYPASS" found a real gap in the validator.
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

function errors(code: string, cf = false): string[] {
  return v(code, cf).errors.map(e => e.message);
}

// ─── Object.* method abuse (n8n CVE-2026-25049) ───

describe('Object builtin method abuse', () => {
  it('Object.getPrototypeOf', () => {
    const blocked = isBlocked('const proto = Object.getPrototypeOf([])');
    console.log(`Object.getPrototypeOf: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
    if (!blocked) console.log('  → Can traverse prototype chain to Function constructor');
  });

  it('Object.getOwnPropertyDescriptor', () => {
    const blocked = isBlocked('const desc = Object.getOwnPropertyDescriptor([], "constructor")');
    console.log(`Object.getOwnPropertyDescriptor: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('Object.getOwnPropertyNames', () => {
    const blocked = isBlocked('const names = Object.getOwnPropertyNames([])');
    console.log(`Object.getOwnPropertyNames: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('Object.create', () => {
    const blocked = isBlocked('const x = Object.create(null)');
    console.log(`Object.create: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('Object.defineProperty', () => {
    const blocked = isBlocked('const x = Object.defineProperty({}, "x", { value: 1 })');
    console.log(`Object.defineProperty: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('Object.setPrototypeOf', () => {
    const blocked = isBlocked('const x = Object.setPrototypeOf({}, null)');
    console.log(`Object.setPrototypeOf: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });
});

// ─── Indirect property access (n8n CVE-2025-68613) ───

describe('Indirect property access via variables', () => {
  it('variable holding "constructor" + bracket notation', () => {
    const blocked = isBlocked('const key = "constructor"\nconst deals = getAllDeals()\nconst ctor = deals[key]');
    console.log(`Variable "constructor" bracket: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('string concat to build "constructor"', () => {
    const blocked = isBlocked('const key = "con" + "structor"\nconst deals = getAllDeals()\nconst ctor = deals[key]');
    console.log(`String concat constructor: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('template literal to build "constructor"', () => {
    const blocked = isBlocked('const key = `${"con"}${"structor"}`\nconst deals = getAllDeals()\nconst ctor = deals[key]');
    console.log(`Template literal constructor: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('variable holding "__proto__" + bracket notation', () => {
    const blocked = isBlocked('const key = "__proto__"\nconst obj = {}\nconst proto = obj[key]');
    console.log(`Variable __proto__ bracket: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });
});

// ─── Computed property names (SandboxJS GHSA-7x3h-rm86-3342) ───

describe('Computed property names in object literals', () => {
  it('computed __proto__ via concat', () => {
    const blocked = isBlocked('const x = { ["__prot" + "o__"]: {} }');
    console.log(`Computed __proto__: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('computed constructor via variable', () => {
    const blocked = isBlocked('const key = "constructor"\nconst x = { [key]: 1 }');
    console.log(`Computed constructor: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });
});

// ─── Callback smuggling ───

describe('Callback smuggling via array/JSON methods', () => {
  it('[].map(getAllDeals)', () => {
    const blocked = isBlocked('const x = [1,2,3].map(getAllDeals)');
    console.log(`Array.map(primitive): ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('[].sort(getAllDeals)', () => {
    const blocked = isBlocked('const x = [1,2,3].sort(getAllDeals)');
    console.log(`Array.sort(primitive): ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('JSON.parse with reviver', () => {
    const blocked = isBlocked('const x = JSON.parse(\'{"a":1}\', getAllDeals)');
    console.log(`JSON.parse(str, primitive): ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });
});

// ─── Console exfiltration ───

describe('Console exfiltration', () => {
  it('console.log data', () => {
    const blocked = isBlocked('const data = getAllDeals()\nconst x = console.log(data)');
    console.log(`console.log: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });
});

// ─── Prototype chain traversal ───

describe('Prototype chain traversal', () => {
  it('triple getPrototypeOf to reach Function', () => {
    const blocked = isBlocked(
      'const arr = [1]\nconst p1 = Object.getPrototypeOf(arr)\nconst p2 = Object.getPrototypeOf(p1)\nconst p3 = Object.getPrototypeOf(p2)',
    );
    console.log(`Triple getPrototypeOf: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('getPrototypeOf on primitive return', () => {
    const blocked = isBlocked('const deals = getAllDeals()\nconst proto = Object.getPrototypeOf(deals)');
    console.log(`getPrototypeOf(primitive result): ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('full escape chain: data → proto → constructor → Function → process', () => {
    const blocked = isBlocked(
      `const deals = getAllDeals()
const proto = Object.getPrototypeOf(deals)
const ctor = proto.constructor
const fn = ctor.constructor
const proc = fn("return process")()`,
    );
    console.log(`Full escape chain: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
    if (!blocked) console.log('  → CRITICAL: Can reach process object from any primitive return value');
  });
});

// ─── toString/valueOf abuse ───

describe('Type coercion abuse', () => {
  it('toString override with primitive', () => {
    const blocked = isBlocked('const x = { toString: getAllDeals }');
    console.log(`toString override: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });

  it('valueOf override with primitive', () => {
    const blocked = isBlocked('const x = { valueOf: getAllDeals }');
    console.log(`valueOf override: ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });
});

// ─── Dynamic import ───

describe('Dynamic import', () => {
  it('import("fs")', () => {
    const blocked = isBlocked('const mod = import("fs")');
    console.log(`import(): ${blocked ? 'BLOCKED ✓' : 'BYPASS ⚠️'}`);
  });
});

// ─── Summary ───

describe('SUMMARY', () => {
  it('print attack surface report', () => {
    const attacks = [
      ['Object.getPrototypeOf', 'const proto = Object.getPrototypeOf([])'],
      ['Object.getOwnPropertyDescriptor', 'const desc = Object.getOwnPropertyDescriptor([], "constructor")'],
      ['Object.getOwnPropertyNames', 'const names = Object.getOwnPropertyNames([])'],
      ['Object.create', 'const x = Object.create(null)'],
      ['Object.defineProperty', 'const x = Object.defineProperty({}, "x", { value: 1 })'],
      ['Object.setPrototypeOf', 'const x = Object.setPrototypeOf({}, null)'],
      ['Var "constructor" + bracket', 'const key = "constructor"\nconst d = getAllDeals()\nconst c = d[key]'],
      ['String concat constructor', 'const key = "con" + "structor"\nconst d = getAllDeals()\nconst c = d[key]'],
      ['Template literal constructor', 'const key = `${"con"}${"structor"}`\nconst d = getAllDeals()\nconst c = d[key]'],
      ['Computed __proto__', 'const x = { ["__prot" + "o__"]: {} }'],
      ['[].map(primitive)', 'const x = [1,2,3].map(getAllDeals)'],
      ['JSON.parse(str, primitive)', 'const x = JSON.parse(\'{"a":1}\', getAllDeals)'],
      ['console.log(data)', 'const data = getAllDeals()\nconst x = console.log(data)'],
      ['Full escape chain', 'const d = getAllDeals()\nconst p = Object.getPrototypeOf(d)\nconst c = p.constructor'],
      ['toString override', 'const x = { toString: getAllDeals }'],
      ['import()', 'const mod = import("fs")'],
    ] as const;

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
    console.log('║        ATTACK SURFACE REPORT             ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Blocked: ${blocked.length.toString().padEnd(30)}║`);
    console.log(`║  Bypasses: ${bypasses.length.toString().padEnd(29)}║`);
    console.log('╚══════════════════════════════════════════╝');

    if (bypasses.length > 0) {
      console.log('\n🚨 BYPASSES FOUND:');
      bypasses.forEach(b => console.log(`   ⚠️  ${b}`));
    }

    if (blocked.length > 0) {
      console.log('\n✅ BLOCKED:');
      blocked.forEach(b => console.log(`   ✓  ${b}`));
    }

    console.log('');
    expect(true).toBe(true); // Always pass — this is a reporting test
  });
});
