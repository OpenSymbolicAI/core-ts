/**
 * Tests for the ScientificCalculator example.
 *
 * Uses a MockLLM for testing without real API calls.
 * Plans use proper TypeScript syntax (const declarations)
 * since the parser is now the TypeScript Compiler API.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlanExecute,
  primitive,
  decomposition,
  recordExample,
  LLM,
  type LLMResponse,
} from '../src/index.js';

// ============================================================
// Mock LLM
// ============================================================

class MockLLM extends LLM {
  private responses: Map<string, string> = new Map();

  constructor() {
    super({ provider: 'openai', model: 'mock' });
  }

  setResponse(taskPattern: string, plan: string): void {
    this.responses.set(taskPattern, plan);
  }

  protected async generateImpl(prompt: string): Promise<LLMResponse> {
    for (const [pattern, plan] of this.responses) {
      if (prompt.includes(pattern)) {
        return {
          text: '```typescript\n' + plan + '\n```',
          usage: { inputTokens: 100, outputTokens: 50 },
          provider: 'mock',
          model: 'mock',
        };
      }
    }

    return {
      text: '```typescript\nconst result = add(2, 3)\n```',
      usage: { inputTokens: 100, outputTokens: 50 },
      provider: 'mock',
      model: 'mock',
    };
  }

  protected getDefaultBaseUrl(): string {
    return 'http://mock';
  }
}

// ============================================================
// Calculator (test-local copy)
// ============================================================

class Calculator extends PlanExecute {
  private memory = 0;

  @primitive({ readOnly: true, docstring: 'Add two numbers' })
  add(a: number, b: number): number { return a + b; }

  @primitive({ readOnly: true, docstring: 'Subtract two numbers' })
  subtract(a: number, b: number): number { return a - b; }

  @primitive({ readOnly: true, docstring: 'Multiply two numbers' })
  multiply(a: number, b: number): number { return a * b; }

  @primitive({ readOnly: true, docstring: 'Divide two numbers' })
  divide(a: number, b: number): number {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  }

  @primitive({ readOnly: true })
  squareRoot(n: number): number {
    if (n < 0) throw new Error('Cannot calculate square root of negative number');
    return Math.sqrt(n);
  }

  @primitive({ readOnly: true })
  power(base: number, exponent: number): number {
    return Math.pow(base, exponent);
  }

  @primitive({ readOnly: true })
  absoluteValue(n: number): number { return Math.abs(n); }

  @primitive({ readOnly: true })
  roundTo(n: number, decimals: number = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  }

  @primitive({ readOnly: true })
  formatNumber(
    value: number,
    options?: { decimals?: number; prefix?: string; suffix?: string }
  ): string {
    const decimals = options?.decimals ?? 2;
    const prefix = options?.prefix ?? '';
    const suffix = options?.suffix ?? '';
    return `${prefix}${value.toFixed(decimals)}${suffix}`;
  }

  @primitive({ readOnly: false })
  memoryStore(value: number): void { this.memory = value; }

  @primitive({ readOnly: true })
  memoryRecall(): number { return this.memory; }

  @primitive({ readOnly: false })
  memoryClear(): number { this.memory = 0; return this.memory; }

  @primitive({ readOnly: false })
  memoryAdd(value: number): number {
    this.memory += value;
    return this.memory;
  }

  @decomposition(
    'Calculate the area of a circle given radius',
    recordExample(calc => {
      calc.radius_squared = calc.multiply(calc.radius, calc.radius);
      calc.area = calc.multiply(calc.radius_squared, 3.14159);
    }),
    'Use formula: π * r²'
  )
  _exampleCircleArea() {}

  @decomposition(
    'Calculate the hypotenuse of a right triangle given two sides',
    recordExample(calc => {
      calc.a_squared = calc.multiply(calc.a, calc.a);
      calc.b_squared = calc.multiply(calc.b, calc.b);
      calc.sum_of_squares = calc.add(calc.a_squared, calc.b_squared);
      calc.hypotenuse = calc.squareRoot(calc.sum_of_squares);
    }),
    'Use Pythagorean theorem: √(a² + b²)'
  )
  _exampleHypotenuse() {}
}

// ============================================================
// Tests
// ============================================================

describe('Calculator', () => {
  let mockLLM: MockLLM;
  let calc: Calculator;

  beforeEach(() => {
    mockLLM = new MockLLM();
    calc = new Calculator(mockLLM, 'Calculator', 'A test calculator');
  });

  describe('Decorator Registration', () => {
    it('should register all primitive methods', () => {
      const primitives = calc.getPrimitiveNames();
      expect(primitives).toContain('add');
      expect(primitives).toContain('subtract');
      expect(primitives).toContain('multiply');
      expect(primitives).toContain('divide');
      expect(primitives).toContain('squareRoot');
      expect(primitives).toContain('power');
      expect(primitives).toContain('absoluteValue');
      expect(primitives).toContain('roundTo');
      expect(primitives).toContain('formatNumber');
      expect(primitives).toContain('memoryStore');
      expect(primitives).toContain('memoryRecall');
      expect(primitives).toContain('memoryClear');
      expect(primitives).toContain('memoryAdd');
      expect(primitives).toHaveLength(13);
    });

    it('should register all decomposition examples', () => {
      const decompositions = calc.getDecompositionNames();
      expect(decompositions).toContain('_exampleCircleArea');
      expect(decompositions).toContain('_exampleHypotenuse');
      expect(decompositions).toHaveLength(2);
    });
  });

  describe('Primitive Methods - Arithmetic', () => {
    it('add should return sum of two numbers', () => {
      expect(calc.add(2, 3)).toBe(5);
      expect(calc.add(-1, 1)).toBe(0);
      expect(calc.add(0.1, 0.2)).toBeCloseTo(0.3);
    });

    it('subtract should return difference', () => {
      expect(calc.subtract(5, 3)).toBe(2);
      expect(calc.subtract(3, 5)).toBe(-2);
    });

    it('multiply should return product', () => {
      expect(calc.multiply(3, 4)).toBe(12);
      expect(calc.multiply(-2, 3)).toBe(-6);
      expect(calc.multiply(0, 100)).toBe(0);
    });

    it('divide should return quotient', () => {
      expect(calc.divide(10, 2)).toBe(5);
      expect(calc.divide(7, 2)).toBe(3.5);
    });

    it('divide should throw on division by zero', () => {
      expect(() => calc.divide(5, 0)).toThrow('Division by zero');
    });
  });

  describe('Primitive Methods - Advanced Math', () => {
    it('squareRoot should return square root', () => {
      expect(calc.squareRoot(4)).toBe(2);
      expect(calc.squareRoot(9)).toBe(3);
      expect(calc.squareRoot(0)).toBe(0);
    });

    it('squareRoot should throw on negative numbers', () => {
      expect(() => calc.squareRoot(-1)).toThrow('Cannot calculate square root of negative number');
    });

    it('power should raise base to exponent', () => {
      expect(calc.power(2, 3)).toBe(8);
      expect(calc.power(10, 0)).toBe(1);
      expect(calc.power(2, -1)).toBe(0.5);
    });

    it('absoluteValue should return absolute value', () => {
      expect(calc.absoluteValue(-5)).toBe(5);
      expect(calc.absoluteValue(5)).toBe(5);
    });

    it('roundTo should round to specified decimal places', () => {
      expect(calc.roundTo(3.14159, 2)).toBe(3.14);
      expect(calc.roundTo(3.14159, 4)).toBe(3.1416);
    });
  });

  describe('Primitive Methods - Memory', () => {
    it('memoryStore and memoryRecall', () => {
      calc.memoryStore(42);
      expect(calc.memoryRecall()).toBe(42);
    });

    it('memoryClear should reset to zero', () => {
      calc.memoryStore(100);
      calc.memoryClear();
      expect(calc.memoryRecall()).toBe(0);
    });

    it('memoryAdd should accumulate', () => {
      calc.memoryStore(10);
      expect(calc.memoryAdd(5)).toBe(15);
      expect(calc.memoryAdd(5)).toBe(20);
    });
  });

  describe('Plan Execution (TS Compiler API)', () => {
    it('should execute simple addition plan', async () => {
      mockLLM.setResponse('2 + 3', 'const result = add(2, 3)');
      const result = await calc.run('What is 2 + 3?');

      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
    });

    it('should execute multi-step plan', async () => {
      mockLLM.setResponse('area', [
        'const radius = 5',
        'const radius_squared = multiply(radius, radius)',
        'const area = multiply(radius_squared, 3.14159)',
      ].join('\n'));

      const result = await calc.run('Calculate the area of a circle with radius 5');

      expect(result.success).toBe(true);
      expect(result.result).toBeCloseTo(78.54, 1);
    });

    it('should execute hypotenuse calculation', async () => {
      mockLLM.setResponse('hypotenuse', [
        'const a_squared = multiply(3, 3)',
        'const b_squared = multiply(4, 4)',
        'const sum_of_squares = add(a_squared, b_squared)',
        'const hypotenuse = squareRoot(sum_of_squares)',
      ].join('\n'));

      const result = await calc.run('Calculate the hypotenuse with sides 3 and 4');

      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
    });

    it('should include execution trace', async () => {
      mockLLM.setResponse('2 + 3', 'const result = add(2, 3)');
      const result = await calc.run('What is 2 + 3?');

      expect(result.trace).toBeDefined();
      expect(result.trace?.steps).toHaveLength(1);
      expect(result.trace?.steps[0].resultValue).toBe(5);
    });

    it('should handle execution errors gracefully', async () => {
      mockLLM.setResponse('divide by zero', 'const result = divide(5, 0)');
      const result = await calc.run('divide by zero');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Division by zero');
    });
  });

  describe('Plan Validation (TS Compiler API)', () => {
    it('should validate correct plans', () => {
      expect(() => calc.validatePlan('const result = add(1, 2)')).not.toThrow();
      expect(() => calc.validatePlan('const a = multiply(2, 3)\nconst b = add(a, 1)')).not.toThrow();
    });

    it('should reject plans with undefined functions', () => {
      expect(() => calc.validatePlan('const result = unknownFunc(1, 2)')).toThrow();
    });

    it('should reject plans with control flow', () => {
      expect(() => calc.validatePlan('for (let i = 0; i < 10; i++) {}')).toThrow();
      expect(() => calc.validatePlan('if (true) { const x = add(1, 2) }')).toThrow();
    });

    it('should reject plans with imports', () => {
      expect(() => calc.validatePlan('import fs from "fs"')).toThrow();
    });

    it('should reject plans with function declarations', () => {
      expect(() => calc.validatePlan('function hack() { return 1 }')).toThrow();
    });

    it('should reject access to dangerous builtins', () => {
      expect(() => calc.validatePlan('const x = eval("1+1")')).toThrow();
      expect(() => calc.validatePlan('const x = process')).toThrow();
    });
  });

  describe('Plan Analysis', () => {
    it('should identify primitive calls in plan', () => {
      const analysis = calc.analyzePlan([
        'const a = add(1, 2)',
        'const b = multiply(a, 3)',
      ].join('\n'));

      expect(analysis.primitiveCalls).toHaveLength(2);
      expect(analysis.primitiveCalls[0].methodName).toBe('add');
      expect(analysis.primitiveCalls[1].methodName).toBe('multiply');
    });

    it('should detect mutations in plan', () => {
      const readOnlyPlan = calc.analyzePlan('const result = add(1, 2)');
      expect(readOnlyPlan.hasMutations).toBe(false);

      const mutatingPlan = calc.analyzePlan('const result = memoryStore(42)');
      expect(mutatingPlan.hasMutations).toBe(true);
    });
  });
});
