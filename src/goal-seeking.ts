/**
 * GoalSeeking<TContext> - Iterative goal-seeking agent.
 *
 * Two-phase loop: plan → execute → introspect → evaluate → repeat.
 *
 * Key design principles:
 * - Raw execution results NEVER leak into planning prompts or evaluation.
 *   updateContext() is the introspection boundary — it transforms raw results
 *   into structured insights on the context object.
 * - Two-tier evaluation:
 *   1. Static: @evaluator decorator on a method (no LLM call)
 *   2. Dynamic: LLM generates evaluator code ONCE before the loop,
 *      then that code runs each iteration without additional LLM calls.
 * - Only custom context fields (not raw traces) are passed to the planner.
 *
 * LLM calls per seek():
 * - With @evaluator:  N calls (1 plan per iteration)
 * - Without @evaluator: 1 + N calls (1 evaluator generation + N plans)
 */

import 'reflect-metadata';
import type { LLM, LLMConfig, LLMCache } from './llm/index.js';
import { getEvaluator } from './core.js';
import { DesignExecute } from './design-execute.js';
import { parsePlan } from './parser/ts-parser.js';
import { PlanInterpreter } from './executor/interpreter.js';
import { ExecutionNamespace, DEFAULT_BUILTINS } from './executor/namespace.js';
import type {
  GoalContext,
  GoalEvaluation,
  GoalIteration,
  GoalSeekingConfig,
  GoalSeekingResult,
  OrchestrationResult,
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
   *
   * Flow per iteration:
   *   1. PLAN   — LLM generates code (1 LLM call)
   *   2. EXECUTE — interpreter runs the plan (no LLM call)
   *   3. INTROSPECT — updateContext() transforms raw result → context insights
   *   4. EVALUATE — @evaluator or LLM-generated code checks context (no LLM call)
   *   5. TERMINATE or LOOP
   */
  async seek(goal: string): Promise<GoalSeekingResult> {
    const maxIterations = this.goalConfig.maxGoalIterations ?? 10;
    const threshold = this.goalConfig.confidenceThreshold ?? 0.9;
    const iterations: GoalIteration[] = [];
    const totalTokens: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const overallStart = performance.now();

    this.context.goal = goal;
    this.context.iterationCount = 0;

    const verbose = this.goalConfig.verbose ?? false;

    // Generate evaluator code once if no @evaluator method exists
    const staticEvaluator = getEvaluator(this);
    let dynamicEvaluatorCode: string | null = null;
    if (!staticEvaluator) {
      if (verbose) this.log('LLM CALL: Generating evaluator code (1 LLM call, runs once)');
      dynamicEvaluatorCode = await this.planEvaluator(goal);
      if (verbose) this.log(`EVALUATOR CODE:\n${dynamicEvaluatorCode}`);
    } else {
      if (verbose) this.log(`Using static @evaluator: ${staticEvaluator}()`);
    }

    for (let i = 0; i < maxIterations; i++) {
      this.context.iterationCount = i + 1;
      const iterStart = performance.now();

      // 1. PLAN + EXECUTE (1 LLM call for plan generation)
      const enrichedTask = this.buildGoalTask(goal);
      if (verbose) this.log(`\n--- Iteration ${i + 1} ---`);
      if (verbose) this.log(`LLM CALL: Planning iteration ${i + 1}`);
      const orchResult = await this.run(enrichedTask);
      if (verbose) {
        this.log(`PLAN:\n${orchResult.plan ?? '(no plan)'}`);
        this.log(`EXECUTE: ${orchResult.success ? 'OK' : 'FAIL'} (${orchResult.trace?.steps.length ?? 0} steps)`);
      }

      // Accumulate tokens
      if (orchResult.metrics?.planTokens) {
        totalTokens.inputTokens += orchResult.metrics.planTokens.inputTokens;
        totalTokens.outputTokens += orchResult.metrics.planTokens.outputTokens;
      }

      // 2. INTROSPECT — raw results → structured context insights
      //    This is THE introspection boundary. Subclasses override this
      //    to extract domain-specific knowledge from raw execution results.
      await this.updateContext(goal, this.context, orchResult);

      // If execution failed, record the error as an observation so the
      // planner learns from it in the next iteration
      if (!orchResult.success && orchResult.error) {
        this.context.observations.push(
          `Iteration ${i + 1} FAILED: ${orchResult.error}`
        );
      }
      if (verbose) {
        const custom = this.getCustomContextFieldValues(this.context);
        this.log(`INTROSPECT: context updated → ${JSON.stringify(custom)}`);
      }

      // 3. EVALUATE — check context (NOT raw results) for goal achievement
      let evaluation: GoalEvaluation;
      if (staticEvaluator) {
        const method = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[staticEvaluator];
        evaluation = await method.call(this, goal, this.context) as GoalEvaluation;
      } else if (dynamicEvaluatorCode) {
        evaluation = await this.runEvaluator(dynamicEvaluatorCode, goal, this.context);
      } else {
        evaluation = { achieved: false, confidence: 0, reasoning: 'No evaluator available' };
      }

      const iterTime = (performance.now() - iterStart) / 1000;

      const iteration: GoalIteration = {
        iterationNumber: i + 1,
        plan: orchResult.plan,
        // NOTE: executionResult stored for debugging, but never passed to LLM
        executionResult: orchResult,
        evaluation,
        contextSnapshot: this.snapshotContext(),
        timeSeconds: iterTime,
      };
      iterations.push(iteration);

      // 4. TERMINATE?
      if (evaluation.achieved && evaluation.confidence >= threshold) {
        return {
          achieved: true,
          iterations,
          finalEvaluation: evaluation,
          finalContext: this.snapshotContext(),
          totalTimeSeconds: (performance.now() - overallStart) / 1000,
          totalTokens,
        };
      }

      if (verbose) {
        this.log(`EVALUATE: achieved=${evaluation.achieved}, confidence=${evaluation.confidence}`);
        if (evaluation.reasoning) this.log(`  reason: ${evaluation.reasoning}`);
      }

      // Feed evaluation reasoning back into context for next iteration
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
      finalContext: this.snapshotContext(),
      totalTimeSeconds: (performance.now() - overallStart) / 1000,
      totalTokens,
    };
  }

  // ============================================================
  // Abstract methods — subclasses must implement
  // ============================================================

  /**
   * Introspection boundary: transform raw execution results into
   * structured insights on the context object.
   *
   * This is THE critical method. Raw ExecutionResult data (traces, steps,
   * variable snapshots) should be distilled into domain-specific context
   * fields. Those context fields — and ONLY those — are what the planner
   * and evaluator see.
   */
  protected abstract updateContext(
    goal: string,
    context: TContext,
    result: OrchestrationResult
  ): Promise<void> | void;

  // ============================================================
  // Evaluator: two-tier (static @evaluator OR dynamic LLM-generated)
  // ============================================================

  /**
   * Generate evaluator code using the LLM (called ONCE before the loop).
   *
   * The LLM produces TypeScript code that checks context fields and
   * assigns `result = { achieved: boolean, confidence: number, reasoning: string }`.
   * This code is then executed each iteration WITHOUT calling the LLM.
   */
  private async planEvaluator(goal: string): Promise<string> {
    const contextFields = this.getCustomContextFields();
    const prompt = this.buildEvaluatorPrompt(goal, contextFields);
    const response = await this.llm.generate(prompt);
    return this.extractCodeBlock(response.text);
  }

  /**
   * Execute LLM-generated evaluator code against the current context.
   * No LLM call — just runs the pre-generated code.
   */
  private async runEvaluator(
    evaluatorCode: string,
    goal: string,
    context: TContext
  ): Promise<GoalEvaluation> {
    try {
      const sourceFile = parsePlan(evaluatorCode);

      // Sandboxed namespace: NO agent, NO primitives.
      // Evaluator code can only read context fields — it cannot call
      // any primitives or access the agent instance.
      const namespace = new ExecutionNamespace({
        agent: {},
        primitives: new Map(),
        builtins: { ...DEFAULT_BUILTINS },
        initialVariables: {
          goal,
          context: { ...context },
          iterationCount: context.iterationCount,
          observations: [...context.observations],
          ...this.getCustomContextFieldValues(context),
        },
      });

      const interpreter = new PlanInterpreter(namespace);
      await interpreter.execute(sourceFile);

      // Read the `result` variable explicitly from namespace
      // rather than relying on finalValue (which is just the last statement)
      const val = namespace.has('result')
        ? namespace.get('result') as Record<string, unknown>
        : null;

      if (val) {
        return {
          achieved: Boolean(val.achieved ?? val.goalAchieved ?? false),
          confidence: Number(val.confidence ?? 0),
          reasoning: String(val.reasoning ?? ''),
          suggestedNextAction: val.suggestedNextAction ? String(val.suggestedNextAction) : undefined,
        };
      }
    } catch (e) {
      const verbose = this.goalConfig.verbose ?? false;
      if (verbose) {
        this.log(`EVALUATOR ERROR: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { achieved: false, confidence: 0, reasoning: 'Evaluator execution failed' };
  }

  // ============================================================
  // Prompt construction
  // ============================================================

  /**
   * Build the planning task for each iteration.
   * Only includes structured context insights — never raw execution traces.
   */
  protected buildGoalTask(goal: string): string {
    const parts: string[] = [];
    parts.push(`Goal: ${goal}`);
    parts.push(`Iteration: ${this.context.iterationCount}`);

    // Include custom context fields (the introspected insights)
    const customFields = this.getCustomContextFieldValues(this.context);
    if (Object.keys(customFields).length > 0) {
      parts.push('');
      parts.push('## Accumulated Knowledge');
      for (const [key, value] of Object.entries(customFields)) {
        parts.push(`- ${key}: ${JSON.stringify(value)}`);
      }
    }

    if (this.context.currentState) {
      parts.push('');
      parts.push(`Current State: ${this.context.currentState}`);
    }

    if (this.context.observations.length > 0) {
      parts.push('');
      parts.push('## Observations from previous iterations');
      for (const obs of this.context.observations.slice(-5)) {
        parts.push(`- ${obs}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Build the prompt for LLM evaluator code generation.
   */
  private buildEvaluatorPrompt(goal: string, contextFields: string[]): string {
    const parts: string[] = [];
    parts.push(`Generate TypeScript code that evaluates whether a goal has been achieved.`);
    parts.push('');
    parts.push(`Goal: "${goal}"`);
    parts.push('');
    parts.push('Available variables:');
    parts.push('- `goal` (string): the goal to evaluate');
    parts.push('- `context` (object): the full context object');
    parts.push('- `iterationCount` (number): current iteration number');
    parts.push('- `observations` (string[]): observations from previous iterations');
    for (const field of contextFields) {
      parts.push(`- \`${field}\`: custom context field`);
    }
    parts.push('');
    parts.push('You must assign a result object:');
    parts.push('```typescript');
    parts.push('const result = { achieved: boolean, confidence: number, reasoning: string }');
    parts.push('```');
    parts.push('');
    parts.push('Rules:');
    parts.push('1. Check the context fields to determine if the goal is achieved');
    parts.push('2. Set confidence between 0 and 1');
    parts.push('3. Provide reasoning explaining your evaluation');
    parts.push('4. You MUST assign to a variable called `result`');
    parts.push('5. Output ONLY TypeScript assignment statements inside a code block');
    parts.push('6. Do NOT use imports, function declarations, or class declarations');
    return parts.join('\n');
  }

  protected override getPlanRules(): string[] {
    return [
      ...super.getPlanRules(),
      `8. This is iteration ${this.context.iterationCount} of a goal-seeking process`,
      '9. Use the accumulated knowledge from previous iterations to improve your approach',
      '10. Do NOT repeat the same evaluations — build on what you already know',
    ];
  }

  // ============================================================
  // Context helpers
  // ============================================================

  /**
   * Get the names of custom fields on the context (beyond GoalContext base fields).
   */
  private getCustomContextFields(): string[] {
    const baseFields = new Set(['goal', 'currentState', 'iterationCount', 'observations']);
    return Object.keys(this.context).filter(k => !baseFields.has(k));
  }

  /**
   * Get the values of custom context fields.
   */
  private getCustomContextFieldValues(context: TContext): Record<string, unknown> {
    const baseFields = new Set(['goal', 'currentState', 'iterationCount', 'observations']);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (!baseFields.has(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  private log(msg: string): void {
    console.log(`[GoalSeeking] ${msg}`);
  }

  /**
   * Create a serializable snapshot of the context.
   */
  private snapshotContext(): Record<string, unknown> {
    try {
      return JSON.parse(JSON.stringify(this.context));
    } catch {
      return { ...this.context } as Record<string, unknown>;
    }
  }
}
