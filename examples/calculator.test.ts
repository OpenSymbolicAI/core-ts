/**
 * Tests for the Calculator example.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlanExecute,
  primitive,
  decomposition,
  LLM,
  type LLMConfig,
  type LLMResponse,
} from '../src/index.js';

// ============================================================
// Mock LLM for testing without real API calls
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
    // Find a matching response based on task content
    for (const [pattern, plan] of this.responses) {
      if (prompt.includes(pattern)) {
        return {
          text: '```python\n' + plan + '\n```',
          usage: { inputTokens: 100, outputTokens: 50 },
          provider: 'mock',
          model: 'mock',
        };
      }
    }

    // Default response for simple addition
    return {
      text: '```python\nresult = add(2, 3)\n```',
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
// Calculator class (duplicated for testing isolation)
// ============================================================

class Calculator extends PlanExecute {
  private memory = 0;

  @primitive({ readOnly: true })
  add(a: number, b: number): number {
    return a + b;
  }

  @primitive({ readOnly: true })
  subtract(a: number, b: number): number {
    return a - b;
  }

  @primitive({ readOnly: true })
  multiply(a: number, b: number): number {
    return a * b;
  }

  @primitive({ readOnly: true })
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    return a / b;
  }

  @primitive({ readOnly: true })
  squareRoot(n: number): number {
    if (n < 0) {
      throw new Error('Cannot calculate square root of negative number');
    }
    return Math.sqrt(n);
  }

  @primitive({ readOnly: true })
  power(base: number, exponent: number): number {
    return Math.pow(base, exponent);
  }

  @primitive({ readOnly: true })
  absoluteValue(n: number): number {
    return Math.abs(n);
  }

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
  memoryStore(value: number): void {
    this.memory = value;
  }

  @primitive({ readOnly: true })
  memoryRecall(): number {
    return this.memory;
  }

  @primitive({ readOnly: false })
  memoryClear(): void {
    this.memory = 0;
  }

  @primitive({ readOnly: false })
  memoryAdd(value: number): number {
    this.memory += value;
    return this.memory;
  }

  @decomposition(
    'Calculate the area of a circle given radius',
    `radius_squared = multiply(radius, radius)
area = multiply(radius_squared, 3.14159)`,
    'Use formula: π * r²'
  )
  _exampleCircleArea() {}

  @decomposition(
    'Calculate the hypotenuse of a right triangle given two sides',
    `a_squared = multiply(a, a)
b_squared = multiply(b, b)
sum_of_squares = add(a_squared, b_squared)
hypotenuse = squareRoot(sum_of_squares)`,
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

    it('subtract should return difference of two numbers', () => {
      expect(calc.subtract(5, 3)).toBe(2);
      expect(calc.subtract(3, 5)).toBe(-2);
      expect(calc.subtract(0, 0)).toBe(0);
    });

    it('multiply should return product of two numbers', () => {
      expect(calc.multiply(3, 4)).toBe(12);
      expect(calc.multiply(-2, 3)).toBe(-6);
      expect(calc.multiply(0, 100)).toBe(0);
    });

    it('divide should return quotient of two numbers', () => {
      expect(calc.divide(10, 2)).toBe(5);
      expect(calc.divide(7, 2)).toBe(3.5);
      expect(calc.divide(-6, 3)).toBe(-2);
    });

    it('divide should throw on division by zero', () => {
      expect(() => calc.divide(5, 0)).toThrow('Division by zero');
    });
  });

  describe('Primitive Methods - Advanced Math', () => {
    it('squareRoot should return square root of a number', () => {
      expect(calc.squareRoot(4)).toBe(2);
      expect(calc.squareRoot(9)).toBe(3);
      expect(calc.squareRoot(2)).toBeCloseTo(1.414, 2);
      expect(calc.squareRoot(0)).toBe(0);
    });

    it('squareRoot should throw on negative numbers', () => {
      expect(() => calc.squareRoot(-1)).toThrow('Cannot calculate square root of negative number');
    });

    it('power should raise base to exponent', () => {
      expect(calc.power(2, 3)).toBe(8);
      expect(calc.power(10, 0)).toBe(1);
      expect(calc.power(5, 1)).toBe(5);
      expect(calc.power(2, -1)).toBe(0.5);
    });

    it('absoluteValue should return absolute value', () => {
      expect(calc.absoluteValue(-5)).toBe(5);
      expect(calc.absoluteValue(5)).toBe(5);
      expect(calc.absoluteValue(0)).toBe(0);
    });

    it('roundTo should round to specified decimal places', () => {
      expect(calc.roundTo(3.14159, 2)).toBe(3.14);
      expect(calc.roundTo(3.14159, 4)).toBe(3.1416);
      expect(calc.roundTo(3.5, 0)).toBe(4);
    });
  });

  describe('Primitive Methods - Formatting', () => {
    it('formatNumber should format with default options', () => {
      expect(calc.formatNumber(3.14159)).toBe('3.14');
    });

    it('formatNumber should respect decimals option', () => {
      expect(calc.formatNumber(3.14159, { decimals: 4 })).toBe('3.1416');
    });

    it('formatNumber should add prefix and suffix', () => {
      expect(calc.formatNumber(100, { prefix: '$', suffix: ' USD' })).toBe('$100.00 USD');
    });
  });

  describe('Primitive Methods - Memory', () => {
    it('memoryStore should store value', () => {
      calc.memoryStore(42);
      expect(calc.memoryRecall()).toBe(42);
    });

    it('memoryRecall should return stored value', () => {
      expect(calc.memoryRecall()).toBe(0); // Initial value
      calc.memoryStore(10);
      expect(calc.memoryRecall()).toBe(10);
    });

    it('memoryClear should reset memory to zero', () => {
      calc.memoryStore(100);
      calc.memoryClear();
      expect(calc.memoryRecall()).toBe(0);
    });

    it('memoryAdd should add to memory and return new value', () => {
      calc.memoryStore(10);
      expect(calc.memoryAdd(5)).toBe(15);
      expect(calc.memoryAdd(5)).toBe(20);
      expect(calc.memoryRecall()).toBe(20);
    });
  });

  describe('Plan Execution', () => {
    it('should execute simple addition plan', async () => {
      mockLLM.setResponse('2 + 3', 'result = add(2, 3)');
      const result = await calc.run('What is 2 + 3?');

      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
    });

    it('should execute multi-step plan', async () => {
      mockLLM.setResponse('area', `radius = 5
radius_squared = multiply(radius, radius)
area = multiply(radius_squared, 3.14159)`);

      const result = await calc.run('Calculate the area of a circle with radius 5');

      expect(result.success).toBe(true);
      expect(result.result).toBeCloseTo(78.54, 1);
    });

    it('should execute hypotenuse calculation', async () => {
      mockLLM.setResponse('hypotenuse', `a_squared = multiply(3, 3)
b_squared = multiply(4, 4)
sum_of_squares = add(a_squared, b_squared)
hypotenuse = squareRoot(sum_of_squares)`);

      const result = await calc.run('Calculate the hypotenuse of a right triangle with sides 3 and 4');

      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
    });

    it('should include execution trace', async () => {
      mockLLM.setResponse('2 + 3', 'result = add(2, 3)');
      const result = await calc.run('What is 2 + 3?');

      expect(result.trace).toBeDefined();
      expect(result.trace?.steps).toHaveLength(1);
      expect(result.trace?.steps[0].statement).toBe('result = add(2, 3)');
      expect(result.trace?.steps[0].resultValue).toBe(5);
    });

    it('should handle execution errors gracefully', async () => {
      mockLLM.setResponse('divide by zero', 'result = divide(5, 0)');
      const result = await calc.run('divide by zero');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Division by zero');
    });
  });

  describe('Plan Validation', () => {
    it('should validate correct plans', () => {
      expect(() => calc.validatePlan('result = add(1, 2)')).not.toThrow();
      expect(() => calc.validatePlan('a = multiply(2, 3)\nb = add(a, 1)')).not.toThrow();
    });

    it('should reject plans with undefined functions', () => {
      expect(() => calc.validatePlan('result = unknownFunc(1, 2)')).toThrow();
    });
  });

  describe('Plan Analysis', () => {
    it('should identify primitive calls in plan', () => {
      const analysis = calc.analyzePlan(`a = add(1, 2)
b = multiply(a, 3)`);

      expect(analysis.primitiveCalls).toHaveLength(2);
      expect(analysis.primitiveCalls[0].methodName).toBe('add');
      expect(analysis.primitiveCalls[1].methodName).toBe('multiply');
    });

    it('should detect mutations in plan', () => {
      const readOnlyPlan = calc.analyzePlan('result = add(1, 2)');
      expect(readOnlyPlan.hasMutations).toBe(false);

      const mutatingPlan = calc.analyzePlan('result = memoryStore(42)');
      expect(mutatingPlan.hasMutations).toBe(true);
    });
  });
});
