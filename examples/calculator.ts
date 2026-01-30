/**
 * Calculator Example - A simple calculator agent demonstrating OpenSymbolicAI.
 *
 * This example shows how to:
 * 1. Create a PlanExecute subclass
 * 2. Define @primitive methods
 * 3. Provide @decomposition examples
 * 4. Run the agent with a task
 */

// Must import reflect-metadata before any decorators are used
import 'reflect-metadata';

import {
  PlanExecute,
  primitive,
  decomposition,
  type LLMConfig,
} from '../src/index.js';

/**
 * A calculator agent that can perform arithmetic operations.
 *
 * The LLM generates plans composed of primitive calls like:
 * ```python
 * a = add(2, 3)
 * b = multiply(a, 4)
 * result = squareRoot(b)
 * ```
 */
class Calculator extends PlanExecute {
  // ============================================================
  // State (for demonstrating mutations)
  // ============================================================

  private memory = 0;

  // ============================================================
  // Primitive Methods (callable by the LLM)
  // ============================================================

  /**
   * Add two numbers.
   */
  @primitive({ readOnly: true })
  add(a: number, b: number): number {
    return a + b;
  }

  /**
   * Subtract two numbers.
   */
  @primitive({ readOnly: true })
  subtract(a: number, b: number): number {
    return a - b;
  }

  /**
   * Multiply two numbers.
   */
  @primitive({ readOnly: true })
  multiply(a: number, b: number): number {
    return a * b;
  }

  /**
   * Divide two numbers.
   */
  @primitive({ readOnly: true })
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    return a / b;
  }

  /**
   * Calculate the square root of a number.
   */
  @primitive({ readOnly: true })
  squareRoot(n: number): number {
    if (n < 0) {
      throw new Error('Cannot calculate square root of negative number');
    }
    return Math.sqrt(n);
  }

  /**
   * Raise a number to a power.
   */
  @primitive({ readOnly: true })
  power(base: number, exponent: number): number {
    return Math.pow(base, exponent);
  }

  /**
   * Get the absolute value of a number.
   */
  @primitive({ readOnly: true })
  absoluteValue(n: number): number {
    return Math.abs(n);
  }

  /**
   * Round a number to a specified number of decimal places.
   */
  @primitive({ readOnly: true })
  roundTo(n: number, decimals: number = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  }

  /**
   * Format a number as a string with options.
   */
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

  // Memory operations (mutations)

  /**
   * Store a value in memory.
   */
  @primitive({ readOnly: false })
  memoryStore(value: number): void {
    this.memory = value;
  }

  /**
   * Recall the value from memory.
   */
  @primitive({ readOnly: true })
  memoryRecall(): number {
    return this.memory;
  }

  /**
   * Clear the memory.
   */
  @primitive({ readOnly: false })
  memoryClear(): void {
    this.memory = 0;
  }

  /**
   * Add a value to memory.
   */
  @primitive({ readOnly: false })
  memoryAdd(value: number): number {
    this.memory += value;
    return this.memory;
  }

  // ============================================================
  // Decomposition Examples (teach the LLM by example)
  // ============================================================

  /**
   * Example: Calculate the area of a circle.
   */
  @decomposition(
    'Calculate the area of a circle given radius',
    `radius_squared = multiply(radius, radius)
area = multiply(radius_squared, 3.14159)`,
    'Use formula: π * r²'
  )
  _exampleCircleArea() {}

  /**
   * Example: Calculate the hypotenuse of a right triangle.
   */
  @decomposition(
    'Calculate the hypotenuse of a right triangle given two sides',
    `a_squared = multiply(a, a)
b_squared = multiply(b, b)
sum_of_squares = add(a_squared, b_squared)
hypotenuse = squareRoot(sum_of_squares)`,
    'Use Pythagorean theorem: √(a² + b²)'
  )
  _exampleHypotenuse() {}

  /**
   * Example: Calculate compound interest.
   */
  @decomposition(
    'Calculate compound interest',
    `one_plus_rate = add(1, rate)
growth_factor = power(one_plus_rate, years)
final_amount = multiply(principal, growth_factor)`,
    'Use formula: P * (1 + r)^t'
  )
  _exampleCompoundInterest() {}

  /**
   * Example: Calculate the percentage of a number.
   */
  @decomposition(
    'Calculate what percentage one number is of another',
    `fraction = divide(part, whole)
percentage = multiply(fraction, 100)`,
    'Use formula: (part / whole) * 100'
  )
  _examplePercentage() {}
}

// ============================================================
// Main - Example usage
// ============================================================

async function main() {
  // Configure the LLM (use environment variables for API keys)
  const config: LLMConfig = {
    provider: 'ollama',
    model: 'gpt-oss:20b',
    params: {
      temperature: 0,
      maxTokens: 1000,
    },
  };

  // Create the calculator agent
  const calc = new Calculator(
    config,
    'Calculator',
    'A scientific calculator that can perform arithmetic operations, calculate formulas, and store values in memory.'
  );

  console.log('Calculator Agent Example');
  console.log('========================\n');

  // Show available primitives
  console.log('Available primitives:', calc.getPrimitiveNames().join(', '));
  console.log('Available decompositions:', calc.getDecompositionNames().join(', '));
  console.log('');

  // Example tasks
  const tasks = [
    'What is 2 + 3?',
    'Calculate the area of a circle with radius 5',
    'What is the hypotenuse of a right triangle with sides 3 and 4?',
    'Calculate 15% of 200',
  ];

  for (const task of tasks) {
    console.log(`\nTask: ${task}`);
    console.log('-'.repeat(50));

    try {
      const result = await calc.run(task);

      if (result.success) {
        console.log(`Result: ${result.result}`);
        console.log(`Plan:\n${result.plan}`);

        if (result.trace) {
          console.log(`\nExecution trace (${result.trace.steps.length} steps):`);
          for (const step of result.trace.steps) {
            console.log(`  ${step.stepNumber}. ${step.statement}`);
            console.log(`     → ${step.resultValue} (${step.resultType})`);
          }
        }

        if (result.metrics) {
          console.log(`\nMetrics:`);
          console.log(`  Plan time: ${result.metrics.planTimeSeconds?.toFixed(2)}s`);
          console.log(`  Exec time: ${result.metrics.executeTimeSeconds?.toFixed(3)}s`);
          console.log(
            `  Tokens: ${result.metrics.planTokens?.inputTokens ?? 0} in / ${result.metrics.planTokens?.outputTokens ?? 0} out`
          );
        }
      } else {
        console.log(`Error: ${result.error}`);
      }
    } catch (e) {
      console.log(`Exception: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// Run if executed directly
main().catch(console.error);

export { Calculator };
