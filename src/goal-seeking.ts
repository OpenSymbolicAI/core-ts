/**
 * GoalSeeking<TContext> - Iterative goal-seeking agent.
 *
 * Extends DesignExecute with an iterative loop:
 * plan → execute → update context → evaluate → repeat until goal achieved.
 *
 * The context is a typed object that carries state between iterations,
 * and the evaluator determines when the goal is met.
 *
 * Matches the .NET GoalSeeking<TContext> blueprint.
 */

import 'reflect-metadata';
import type { LLM, LLMConfig, LLMCache } from './llm/index.js';
import { getEvaluator } from './core.js';
import { DesignExecute } from './design-execute.js';
import type {
  GoalContext,
  GoalEvaluation,
  GoalIteration,
  GoalSeekingConfig,
  GoalSeekingResult,
  TokenUsage,
} from './models.js';

export abstract class GoalSeeking<
  TContext extends GoalContext = GoalContext
> extends DesignExecute {
  protected goalConfig: GoalSeekingConfig;
  protected context: TContext;

  constructor(
    llm: LLM | LLMConfig,
    context: TContext,
    name = '',
    description = '',
    config?: GoalSeekingConfig,
    cache?: LLMCache
  ) {
    super(llm, name, description, config, cache);
    this.goalConfig = config ?? {};
    this.context = context;
  }

  /**
   * Main entry point: iteratively seek the goal.
   */
  async seek(goal: string): Promise<GoalSeekingResult> {
    const maxIterations = this.goalConfig.maxGoalIterations ?? 10;
    const threshold = this.goalConfig.confidenceThreshold ?? 0.9;
    const iterations: GoalIteration[] = [];
    const totalTokens: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const overallStart = performance.now();

    this.context.goal = goal;
    this.context.iterationCount = 0;

    for (let i = 0; i < maxIterations; i++) {
      this.context.iterationCount = i + 1;
      const iterStart = performance.now();

      // Plan and execute
      const enrichedTask = this.buildGoalTask(goal);
      const orchResult = await this.run(enrichedTask);

      // Accumulate tokens
      if (orchResult.metrics?.planTokens) {
        totalTokens.inputTokens += orchResult.metrics.planTokens.inputTokens;
        totalTokens.outputTokens += orchResult.metrics.planTokens.outputTokens;
      }

      // Update context
      await this.updateContext(goal, this.context, orchResult);

      // Evaluate
      const evaluation = await this.evaluateGoal(goal, this.context);
      const iterTime = (performance.now() - iterStart) / 1000;

      const iteration: GoalIteration = {
        iterationNumber: i + 1,
        plan: orchResult.plan,
        executionResult: orchResult,
        evaluation,
        contextSnapshot: { ...this.context } as Record<string, unknown>,
        timeSeconds: iterTime,
      };
      iterations.push(iteration);

      // Check if goal achieved
      if (evaluation.achieved && evaluation.confidence >= threshold) {
        return {
          achieved: true,
          iterations,
          finalEvaluation: evaluation,
          finalContext: { ...this.context } as Record<string, unknown>,
          totalTimeSeconds: (performance.now() - overallStart) / 1000,
          totalTokens,
        };
      }

      // Add observation for next iteration
      if (evaluation.reasoning) {
        this.context.observations.push(
          `Iteration ${i + 1}: ${evaluation.reasoning}`
        );
      }
      if (evaluation.suggestedNextAction) {
        this.context.observations.push(
          `Suggested: ${evaluation.suggestedNextAction}`
        );
      }
    }

    // Max iterations reached
    const finalEval = iterations[iterations.length - 1]?.evaluation;
    return {
      achieved: false,
      iterations,
      finalEvaluation: finalEval,
      finalContext: { ...this.context } as Record<string, unknown>,
      totalTimeSeconds: (performance.now() - overallStart) / 1000,
      totalTokens,
    };
  }

  /**
   * Update the context after each iteration.
   * Override to implement custom context updates.
   */
  protected abstract updateContext(
    goal: string,
    context: TContext,
    result: import('./models.js').OrchestrationResult
  ): Promise<void> | void;

  /**
   * Evaluate whether the goal has been achieved.
   *
   * By default, looks for a method decorated with @evaluator.
   * Override to provide custom evaluation logic.
   */
  protected async evaluateGoal(
    goal: string,
    context: TContext
  ): Promise<GoalEvaluation> {
    const evaluatorName = getEvaluator(this);
    if (evaluatorName) {
      const method = (this as unknown as Record<string, Function>)[evaluatorName];
      if (typeof method === 'function') {
        return await method.call(this, goal, context);
      }
    }

    // Default: not achieved
    return {
      achieved: false,
      confidence: 0,
      reasoning: 'No evaluator defined — override evaluate() or use @evaluator decorator',
    };
  }

  /**
   * Build the task string for each iteration, enriched with context.
   */
  protected buildGoalTask(goal: string): string {
    const parts: string[] = [];
    parts.push(`Goal: ${goal}`);
    parts.push(`Iteration: ${this.context.iterationCount}`);
    parts.push(`Current State: ${this.context.currentState}`);

    if (this.context.observations.length > 0) {
      parts.push('');
      parts.push('Observations from previous iterations:');
      for (const obs of this.context.observations.slice(-5)) {
        parts.push(`- ${obs}`);
      }
    }

    return parts.join('\n');
  }

  protected override getPlanRules(): string[] {
    return [
      ...super.getPlanRules(),
      `8. This is iteration ${this.context.iterationCount} of a goal-seeking process`,
      '9. Use observations from previous iterations to improve your approach',
    ];
  }
}
