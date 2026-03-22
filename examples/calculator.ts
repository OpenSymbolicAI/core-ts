/**
 * Scientific Calculator Example - PlanExecute Blueprint
 *
 * A comprehensive calculator agent with arithmetic, trigonometry,
 * logarithms, powers, and memory operations. Demonstrates the
 * PlanExecute blueprint: LLM generates flat assignment plans
 * composed entirely of primitive calls.
 */

import 'dotenv/config';
import 'reflect-metadata';

import {
  PlanExecute,
  primitive,
  decomposition,
  recordExample,
  type LLMConfig,
} from '../src/index.js';

class ScientificCalculator extends PlanExecute {
  private memory = 0;

  // ==================== Basic Arithmetic ====================

  @primitive({ readOnly: true, docstring: 'Add two numbers' })
  addNumbers(firstNumber: number, secondNumber: number): number {
    return firstNumber + secondNumber;
  }

  @primitive({ readOnly: true, docstring: 'Subtract two numbers' })
  subtractNumbers(minuend: number, subtrahend: number): number {
    return minuend - subtrahend;
  }

  @primitive({ readOnly: true, docstring: 'Multiply two numbers' })
  multiplyNumbers(firstFactor: number, secondFactor: number): number {
    return firstFactor * secondFactor;
  }

  @primitive({ readOnly: true, docstring: 'Divide two numbers' })
  divideNumbers(dividend: number, divisor: number): number {
    if (divisor === 0) throw new Error('Cannot divide by zero');
    return dividend / divisor;
  }

  // ==================== Powers and Roots ====================

  @primitive({ readOnly: true, docstring: 'Raise base to exponent' })
  raiseToPower(baseNumber: number, exponent: number): number {
    return Math.pow(baseNumber, exponent);
  }

  @primitive({ readOnly: true, docstring: 'Square root of a number' })
  squareRootOf(n: number): number {
    if (n < 0) throw new Error('Cannot calculate square root of negative number');
    return Math.sqrt(n);
  }

  // ==================== Trigonometric Functions ====================

  @primitive({ readOnly: true, docstring: 'Sine of angle in radians' })
  sine(angleInRadians: number): number {
    return Math.sin(angleInRadians);
  }

  @primitive({ readOnly: true, docstring: 'Cosine of angle in radians' })
  cosine(angleInRadians: number): number {
    return Math.cos(angleInRadians);
  }

  @primitive({ readOnly: true, docstring: 'Tangent of angle in radians' })
  tangent(angleInRadians: number): number {
    return Math.tan(angleInRadians);
  }

  // ==================== Angle Conversion ====================

  @primitive({ readOnly: true, docstring: 'Convert degrees to radians' })
  convertDegreesToRadians(angleInDegrees: number): number {
    return angleInDegrees * Math.PI / 180.0;
  }

  @primitive({ readOnly: true, docstring: 'Convert radians to degrees' })
  convertRadiansToDegrees(angleInRadians: number): number {
    return angleInRadians * 180.0 / Math.PI;
  }

  // ==================== Logarithms and Exponentials ====================

  @primitive({ readOnly: true, docstring: 'Natural logarithm (ln)' })
  naturalLogarithm(n: number): number {
    if (n <= 0) throw new Error('Logarithm requires positive input');
    return Math.log(n);
  }

  @primitive({ readOnly: true, docstring: 'Base-10 logarithm' })
  logarithmBase10(n: number): number {
    if (n <= 0) throw new Error('Logarithm requires positive input');
    return Math.log10(n);
  }

  @primitive({ readOnly: true, docstring: 'e raised to a power' })
  exponentialEToPower(exponent: number): number {
    return Math.exp(exponent);
  }

  // ==================== Constants ====================

  @primitive({ readOnly: true, docstring: 'Return the value of Pi' })
  getPi(): number {
    return Math.PI;
  }

  @primitive({ readOnly: true, docstring: "Return Euler's number (e)" })
  getEulersNumber(): number {
    return Math.E;
  }

  // ==================== Memory Operations ====================

  @primitive({ readOnly: false, docstring: 'Store a value in memory' })
  memoryStore(value: number): number {
    this.memory = value;
    return this.memory;
  }

  @primitive({ readOnly: true, docstring: 'Recall the value from memory' })
  memoryRecall(): number {
    return this.memory;
  }

  @primitive({ readOnly: false, docstring: 'Add a value to memory' })
  memoryAdd(value: number): number {
    this.memory += value;
    return this.memory;
  }

  @primitive({ readOnly: false, docstring: 'Subtract a value from memory' })
  memorySubtract(value: number): number {
    this.memory -= value;
    return this.memory;
  }

  @primitive({ readOnly: false, docstring: 'Clear memory to zero' })
  memoryClear(): number {
    this.memory = 0;
    return this.memory;
  }

  // ==================== Decompositions ====================

  @decomposition(
    'What is sine of 90 degrees?',
    recordExample(c => {
      c.angleRad = c.convertDegreesToRadians(90);
      c.sin90 = c.sine(c.angleRad);
    }),
    'First convert 90 degrees to radians, then calculate the sine'
  )
  _exampleSine90() {}

  @decomposition(
    'What is cosine of 45 degrees?',
    recordExample(c => {
      c.angleRad = c.convertDegreesToRadians(45);
      c.cos45 = c.cosine(c.angleRad);
    }),
    'First convert 45 degrees to radians, then calculate the cosine'
  )
  _exampleCosine45() {}

  @decomposition(
    'Calculate the area of a circle with radius 5',
    recordExample(c => {
      c.pi = c.getPi();
      c.radiusSquared = c.raiseToPower(5, 2);
      c.area = c.multiplyNumbers(c.pi, c.radiusSquared);
    }),
    'Get pi, then multiply pi by the square of the radius (pi * r^2)'
  )
  _exampleCircleArea() {}

  @decomposition(
    'Calculate the hypotenuse of a right triangle with sides 3 and 4',
    recordExample(c => {
      c.aSquared = c.raiseToPower(3, 2);
      c.bSquared = c.raiseToPower(4, 2);
      c.sumOfSquares = c.addNumbers(c.aSquared, c.bSquared);
      c.hypotenuse = c.squareRootOf(c.sumOfSquares);
    }),
    'Square both sides, add them, take square root (Pythagorean theorem)'
  )
  _exampleHypotenuse() {}

  @decomposition(
    'What is 15% of 200?',
    recordExample(c => {
      c.decimal = c.divideNumbers(15, 100);
      c.result = c.multiplyNumbers(c.decimal, 200);
    }),
    'Divide the percentage by 100 to get the decimal, then multiply by the value'
  )
  _examplePercentage() {}

  @decomposition(
    'Calculate compound interest: principal 1000, rate 5%, time 3 years',
    recordExample(c => {
      c.rateDecimal = c.divideNumbers(5, 100);
      c.rateTimesTime = c.multiplyNumbers(c.rateDecimal, 3);
      c.growthFactor = c.exponentialEToPower(c.rateTimesTime);
      c.finalAmount = c.multiplyNumbers(1000, c.growthFactor);
    }),
    'Use the formula A = P * e^(rt)'
  )
  _exampleCompoundInterest() {}

  @decomposition(
    'What is the average of 10, 20, and 30?',
    recordExample(c => {
      c.sum1 = c.addNumbers(10, 20);
      c.total = c.addNumbers(c.sum1, 30);
      c.average = c.divideNumbers(c.total, 3);
    }),
    'Add all numbers together, then divide by count'
  )
  _exampleAverage() {}

  @decomposition(
    'What is the circumference of a circle with radius 10?',
    recordExample(c => {
      c.pi = c.getPi();
      c.twoPi = c.multiplyNumbers(2, c.pi);
      c.circumference = c.multiplyNumbers(c.twoPi, 10);
    }),
    'circumference = 2 * pi * r'
  )
  _exampleCircumference() {}
}

// ============================================================
// Main
// ============================================================

async function main() {
  const config: LLMConfig = {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    apiKey: process.env.GROQ_API_KEY,
    params: { temperature: 0, maxTokens: 1000 },
  };

  const calc = new ScientificCalculator(
    config,
    'ScientificCalculator',
    'A scientific calculator with arithmetic, trigonometry, logarithms, powers, and memory.'
  );

  console.log('Scientific Calculator Agent');
  console.log('==========================\n');
  console.log('Primitives:', calc.getPrimitiveNames().join(', '));
  console.log('');

  const tasks = [
    'What is sine of 90 degrees?',
    'Calculate the area of a circle with radius 5',
    'What is the hypotenuse of a right triangle with sides 3 and 4?',
    'Calculate 15% of 200',
    'What is ln(e)?',
  ];

  for (const task of tasks) {
    console.log(`\nTask: ${task}`);
    console.log('-'.repeat(50));

    try {
      const result = await calc.run(task);
      if (result.success) {
        console.log(`Result: ${result.result}`);
        if (result.trace) {
          for (const step of result.trace.steps) {
            console.log(`  ${step.stepNumber}. ${step.statement} => ${step.resultValue}`);
          }
        }
      } else {
        console.log(`Error: ${result.error}`);
      }
    } catch (e) {
      console.log(`Exception: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch(console.error);

export { ScientificCalculator };
