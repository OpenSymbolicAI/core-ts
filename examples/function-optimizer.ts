/**
 * Function Optimizer Example - GoalSeeking Blueprint
 *
 * Agent that finds the global maximum of a mystery function.
 * The function is non-monotonic with multiple peaks and valleys.
 * The agent can only observe f(x) at chosen points and must reason
 * about where to sample next based on accumulated observations.
 *
 * Demonstrates GoalSeeking's iterative loop:
 * plan → execute → update context → evaluate → repeat
 *
 * f(x) = sin(3x)*exp(-0.1*(x-5)^2) + 0.5*cos(7x)*exp(-0.05*(x-12)^2)
 * Domain: [0, 20], global max near x ≈ 4.7
 */

import 'dotenv/config';
import 'reflect-metadata';

import {
  GoalSeeking,
  primitive,
  decomposition,
  type LLMConfig,
  type GoalContext,
  type GoalEvaluation,
  type GoalSeekingConfig,
  type OrchestrationResult,
  type LLMCache,
} from '../src/index.js';

// ============================================================
// Domain Types
// ============================================================

interface Sample {
  x: number;
  value: number;
}

interface OptimizationContext extends GoalContext {
  samples: Sample[];
  bestX: number | null;
  bestValue: number | null;
  converged: boolean;
}

function createOptimizationContext(): OptimizationContext {
  return {
    goal: '',
    currentState: 'No samples yet',
    iterationCount: 0,
    observations: [],
    samples: [],
    bestX: null,
    bestValue: null,
    converged: false,
  };
}

// ============================================================
// Target Function
// ============================================================

function targetFunction(x: number): number {
  return Math.sin(3 * x) * Math.exp(-0.1 * Math.pow(x - 5, 2))
    + 0.5 * Math.cos(7 * x) * Math.exp(-0.05 * Math.pow(x - 12, 2));
}

function computeTrueMax(): { x: number; value: number } {
  let bestX = 0;
  let bestVal = targetFunction(0);
  for (let i = 0; i <= 200000; i++) {
    const x = i * 20.0 / 200000;
    const val = targetFunction(x);
    if (val > bestVal) {
      bestVal = val;
      bestX = x;
    }
  }
  return { x: bestX, value: bestVal };
}

// ============================================================
// FunctionOptimizer Agent
// ============================================================

class FunctionOptimizer extends GoalSeeking<OptimizationContext> {
  private tolerance: number;
  public trueMax: { x: number; value: number };

  constructor(
    llm: import('../src/llm/index.js').LLM | LLMConfig,
    tolerance = 0.01,
    maxIterations = 25,
    cache?: LLMCache
  ) {
    const config: GoalSeekingConfig = {
      maxGoalIterations: maxIterations,
      confidenceThreshold: 0.95,
    };
    super(llm, createOptimizationContext(), 'FunctionOptimizer',
      'Finds the global maximum of a function by sampling points', config, cache);
    this.tolerance = tolerance;
    this.trueMax = computeTrueMax();
  }

  @primitive({ readOnly: true, docstring: 'Evaluate the target function at x (domain: [0, 20])' })
  evaluate(x: number): number {
    x = Math.max(0, Math.min(20, x));
    return Math.round(targetFunction(x) * 1000000) / 1000000;
  }

  // ---- Decompositions ----

  @decomposition(
    'Explore the function across the range',
    `const v1 = evaluate(3.0)
const v2 = evaluate(8.0)
const v3 = evaluate(14.0)`,
    'Sample multiple spread-out points to understand the function shape'
  )
  _exampleExplore() {}

  @decomposition(
    'Refine around a promising region',
    `const v1 = evaluate(4.5)
const v2 = evaluate(5.0)
const v3 = evaluate(5.5)`,
    'Sample nearby points around the current best to find the peak precisely'
  )
  _exampleRefine() {}

  // ---- GoalSeeking overrides ----

  protected override updateContext(
    _goal: string,
    context: OptimizationContext,
    result: OrchestrationResult
  ): void {
    if (!result.trace) return;

    for (const step of result.trace.steps) {
      if (step.primitiveCalled !== 'evaluate' || !step.success) continue;
      if (!step.args || !step.args['arg0']) continue;

      const xVal = Number(step.args['arg0'].resolvedValue ?? step.args['arg0'].expression);
      const fVal = Number(step.resultValue);

      if (isNaN(xVal) || isNaN(fVal)) continue;
      context.samples.push({ x: xVal, value: fVal });

      if (context.bestValue === null || fVal > context.bestValue) {
        context.bestX = xVal;
        context.bestValue = fVal;
      }
    }

    // Update state description for next iteration
    if (context.bestX !== null && context.bestValue !== null) {
      context.currentState = `Best so far: f(${context.bestX.toFixed(4)}) = ${context.bestValue.toFixed(6)}, ${context.samples.length} total samples`;
    }

    // Check convergence
    if (context.bestValue !== null && Math.abs(context.bestValue - this.trueMax.value) < this.tolerance) {
      context.converged = true;
    }
  }

  protected override async evaluateGoal(
    _goal: string,
    context: OptimizationContext
  ): Promise<GoalEvaluation> {
    return {
      achieved: context.converged,
      confidence: context.converged ? 1.0 : 0,
      reasoning: context.converged
        ? `Converged! Found maximum within tolerance.`
        : context.bestValue !== null
          ? `Best value so far: ${context.bestValue.toFixed(6)}, gap: ${Math.abs(this.trueMax.value - context.bestValue).toFixed(6)}`
          : 'No samples yet.',
    };
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const config: LLMConfig = {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    apiKey: process.env.GROQ_API_KEY,
    params: { temperature: 0.3, maxTokens: 2000 },
  };

  console.log('Function Optimizer Agent');
  console.log('=======================');
  console.log('Goal: Find the global maximum of f(x) on [0, 20]');
  console.log('f(x) = sin(3x)*exp(-0.1*(x-5)^2) + 0.5*cos(7x)*exp(-0.05*(x-12)^2)');
  console.log('');

  const optimizer = new FunctionOptimizer(config, 0.01, 25);
  console.log(`True maximum: f(${optimizer.trueMax.x.toFixed(4)}) = ${optimizer.trueMax.value.toFixed(6)}`);
  console.log('');

  console.log('Iterating...');
  const result = await optimizer.seek('Find the x in [0, 20] that maximizes the function f(x)');

  for (const iter of result.iterations) {
    const steps = iter.executionResult?.trace?.steps ?? [];
    const evalSteps = steps
      .filter(s => s.primitiveCalled === 'evaluate' && s.success)
      .map(s => `f(${s.args?.['arg0']?.expression})=${s.resultValue}`);

    console.log(`  #${iter.iterationNumber}: ${evalSteps.join(', ')}`);
  }

  console.log('');
  console.log('='.repeat(60));

  if (result.achieved) {
    console.log('Converged! Found maximum near the true optimum.');
  } else {
    console.log('Ran out of iterations without converging.');
  }

  const ctx = result.finalContext as unknown as OptimizationContext;
  console.log(`Total evaluations: ${ctx.samples.length}`);
  if (ctx.bestX !== null && ctx.bestValue !== null) {
    console.log(`Best found:   f(${ctx.bestX.toFixed(4)}) = ${ctx.bestValue.toFixed(6)}`);
    console.log(`True maximum: f(${optimizer.trueMax.x.toFixed(4)}) = ${optimizer.trueMax.value.toFixed(6)}`);
    console.log(`Gap: ${Math.abs(optimizer.trueMax.value - ctx.bestValue).toFixed(6)}`);
  }
  console.log(`Iterations used: ${result.iterations.length}`);
}

main().catch(console.error);

export { FunctionOptimizer, targetFunction, computeTrueMax, type OptimizationContext, type Sample };
