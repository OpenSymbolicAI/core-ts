/**
 * PlanExecute - The main class for AI-native plan-and-execute agents.
 *
 * Subclass PlanExecute and define @primitive methods to create an agent.
 * The LLM will generate plans composed of your primitive calls,
 * which are then safely interpreted and executed.
 */

import 'reflect-metadata';
import {
  type LLM,
  type LLMConfig,
  type LLMCache,
  createLLM,
  isLLM,
} from './llm/index.js';
import {
  getPrimitives,
  getDecompositions,
  formatPrimitiveSignatures,
  formatDecompositionExamples,
} from './core.js';
import { PlanParser, validatePlanOrThrow, DEFAULT_ALLOWED_BUILTINS } from './parser/index.js';
import { ExecutionNamespace, DEFAULT_BUILTINS, PlanInterpreter } from './executor/index.js';
import { PlanValidationError } from './exceptions.js';
import type {
  PrimitiveMetadata,
  DecompositionMetadata,
  PlanResult,
  ExecutionResult,
  ExecutionTrace,
  OrchestrationResult,
  PlanAttempt,
  ConversationTurn,
  MutationHookContext,
  PlanGeneration,
} from './models.js';

/**
 * Configuration options for PlanExecute.
 */
export interface PlanExecuteConfig {
  /**
   * Custom builtins to make available in plans.
   * Merged with DEFAULT_BUILTINS.
   */
  allowedBuiltins?: Record<string, Function>;

  /**
   * Whether to skip JSON serialization of results.
   */
  skipResultSerialization?: boolean;

  /**
   * Enable multi-turn mode where variables persist across runs.
   */
  multiTurn?: boolean;

  /**
   * Callback invoked before executing mutations.
   * Return a string to reject the mutation with that reason.
   */
  onMutation?: (context: MutationHookContext) => string | null | undefined;

  /**
   * Maximum number of plan generation retries on validation failure.
   */
  maxPlanRetries?: number;

  /**
   * Whether to require explicit approval for mutations.
   */
  requireMutationApproval?: boolean;

  /**
   * Worker ID for distributed execution.
   */
  workerId?: string;
}

/**
 * Abstract base class for plan-and-execute agents.
 *
 * Subclass this and define @primitive methods to create your agent.
 *
 * @example
 * ```typescript
 * class Calculator extends PlanExecute {
 *   @primitive({ readOnly: true })
 *   add(a: number, b: number): number {
 *     return a + b;
 *   }
 *
 *   @decomposition(
 *     'Add two numbers',
 *     'const result = add(2, 3)'
 *   )
 *   _exampleAdd() {}
 * }
 *
 * const calc = new Calculator(llmConfig, 'Calculator', 'A simple calculator');
 * const result = await calc.run('Add 2 and 3');
 * ```
 */
export abstract class PlanExecute {
  protected llm: LLM;
  protected config: PlanExecuteConfig;
  protected parser = new PlanParser();

  private primitives: Map<string, PrimitiveMetadata>;
  private decompositions: Map<string, DecompositionMetadata>;
  private history: ConversationTurn[] = [];
  private persistedNamespace: Record<string, unknown> = {};

  /**
   * Create a new PlanExecute agent.
   *
   * @param llm - LLM instance or configuration
   * @param name - Agent name (used in prompts)
   * @param description - Agent description (used in prompts)
   * @param config - Optional configuration
   * @param cache - Optional LLM cache
   */
  constructor(
    llm: LLM | LLMConfig,
    public name: string = '',
    public description: string = '',
    config?: PlanExecuteConfig,
    cache?: LLMCache
  ) {
    this.llm = isLLM(llm) ? llm : createLLM(llm, cache);
    this.config = config ?? {};
    this.name = name || this.constructor.name;

    // Introspect decorated methods
    this.primitives = getPrimitives(this);
    this.decompositions = getDecompositions(this);
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Run a task: generate a plan and execute it.
   */
  async run(task: string): Promise<OrchestrationResult> {
    const maxRetries = this.config.maxPlanRetries ?? 2;
    const planAttempts: PlanAttempt[] = [];
    let lastPlan = '';
    let lastError = '';

    // Plan generation with retries
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const feedback = attempt > 0 ? lastError : undefined;
        const planResult = await this.plan(task, feedback);
        lastPlan = planResult.plan;

        planAttempts.push({
          attemptNumber: attempt + 1,
          plan: planResult.plan,
          validationError: null,
          feedback: feedback ?? null,
        });

        // Validate the plan
        this.validatePlan(planResult.plan);

        // Execute the plan
        const execResult = await this.execute(planResult.plan);
        const allSucceeded = execResult.trace.steps.every((s) => s.success);

        // Record in multi-turn history
        if (this.config.multiTurn) {
          this.history.push({
            role: 'user',
            task,
            timestamp: new Date(),
          });
          this.history.push({
            role: 'assistant',
            task,
            plan: planResult.plan,
            result: allSucceeded ? JSON.parse(execResult.valueJson) : undefined,
            error: allSucceeded
              ? undefined
              : execResult.trace.steps.find((s) => !s.success)?.error ?? undefined,
            timestamp: new Date(),
          });
        }

        return {
          success: allSucceeded,
          result: allSucceeded ? JSON.parse(execResult.valueJson) : null,
          error: allSucceeded
            ? null
            : execResult.trace.steps.find((s) => !s.success)?.error ?? 'Unknown error',
          metrics: {
            planTokens: planResult.usage,
            planTimeSeconds: planResult.timeSeconds,
            executeTimeSeconds: execResult.trace.totalTimeSeconds,
            stepsExecuted: execResult.trace.steps.length,
            provider: planResult.provider,
            model: planResult.model,
          },
          plan: planResult.plan,
          trace: execResult.trace,
          planAttempts,
          task,
        };
      } catch (e) {
        if (e instanceof PlanValidationError) {
          lastError = e.message;
          planAttempts[planAttempts.length - 1].validationError = e.message;

          if (attempt === maxRetries) {
            return {
              success: false,
              result: null,
              error: `Plan validation failed after ${maxRetries + 1} attempts: ${e.message}`,
              plan: lastPlan,
              planAttempts,
              task,
            };
          }
          // Continue to next retry
        } else {
          // Unexpected error
          return {
            success: false,
            result: null,
            error: e instanceof Error ? e.message : String(e),
            plan: lastPlan,
            planAttempts,
            task,
          };
        }
      }
    }

    // Should not reach here
    return {
      success: false,
      result: null,
      error: 'Unexpected error in run loop',
      task,
    };
  }

  /**
   * Generate a plan for a task without executing it.
   */
  async plan(task: string, feedback?: string): Promise<PlanResult> {
    const prompt = this.buildPlanPrompt(task, feedback);
    const startTime = performance.now();

    const response = await this.llm.generate(prompt);
    const elapsed = (performance.now() - startTime) / 1000;

    const planText = this.extractCodeBlock(response.text);

    const planGeneration: PlanGeneration = {
      prompt,
      rawResponse: response.text,
      extractedCode: planText,
      usage: response.usage,
    };

    return {
      plan: planText,
      usage: response.usage,
      timeSeconds: elapsed,
      provider: response.provider,
      model: response.model,
      planGeneration,
    };
  }

  /**
   * Validate a plan without executing it.
   */
  validatePlan(planText: string): void {
    const plan = this.parser.parse(planText);
    const primitiveNames = new Set(this.primitives.keys());
    const builtinNames = new Set([
      ...DEFAULT_ALLOWED_BUILTINS,
      ...Object.keys(this.config.allowedBuiltins ?? {}),
    ]);

    validatePlanOrThrow(plan, {
      primitiveNames,
      allowedBuiltins: builtinNames,
      allowSelfCalls: true,
    });
  }

  /**
   * Execute a plan that has already been validated.
   */
  async execute(planText: string): Promise<ExecutionResult> {
    // Parse the plan
    const plan = this.parser.parse(planText);

    // Create execution namespace
    const builtins = {
      ...DEFAULT_BUILTINS,
      ...(this.config.allowedBuiltins ?? {}),
    };

    const namespace = new ExecutionNamespace({
      agent: this,
      primitives: this.primitives,
      builtins,
      initialVariables: this.config.multiTurn ? this.persistedNamespace : {},
    });

    // Create interpreter
    const interpreter = new PlanInterpreter(namespace, {
      onMutation: this.config.onMutation,
      skipResultSerialization: this.config.skipResultSerialization,
    });

    // Execute
    const result = await interpreter.execute(plan);

    // Persist namespace for multi-turn
    if (this.config.multiTurn) {
      this.persistedNamespace = namespace.snapshot();
    }

    // Build trace
    const trace: ExecutionTrace = {
      steps: result.steps,
      totalTimeSeconds: result.steps.reduce((sum: number, s) => sum + s.timeSeconds, 0),
    };

    const lastStep = result.steps[result.steps.length - 1];

    return {
      valueType: lastStep?.resultType ?? 'undefined',
      valueName: result.finalVariable,
      valueJson: lastStep?.resultJson ?? 'null',
      trace,
    };
  }

  /**
   * Analyze a plan to extract primitive calls.
   */
  analyzePlan(planText: string): {
    primitiveCalls: Array<{
      methodName: string;
      args: Record<string, string>;
      statement: string;
      line: number;
    }>;
    hasMutations: boolean;
  } {
    const plan = this.parser.parse(planText);
    const calls: Array<{
      methodName: string;
      args: Record<string, string>;
      statement: string;
      line: number;
    }> = [];

    let hasMutations = false;

    for (const stmt of plan.statements) {
      if (stmt.value.type === 'call') {
        let methodName = stmt.value.callee;
        if (methodName.startsWith('this.')) {
          methodName = methodName.slice(5);
        }

        const args: Record<string, string> = {};
        stmt.value.args.forEach((arg, i) => {
          args[`arg${i}`] =
            arg.type === 'identifier'
              ? arg.name
              : arg.type === 'string'
                ? `"${arg.value}"`
                : String('value' in arg ? arg.value : arg.type);
        });
        for (const [key, value] of Object.entries(stmt.value.kwargs)) {
          args[key] =
            value.type === 'identifier'
              ? value.name
              : value.type === 'string'
                ? `"${value.value}"`
                : String('value' in value ? value.value : value.type);
        }

        const meta = this.primitives.get(methodName);
        if (meta && !meta.readOnly) {
          hasMutations = true;
        }

        calls.push({
          methodName,
          args,
          statement: `${stmt.variable} = ${stmt.value.callee}(...)`,
          line: stmt.line,
        });
      }
    }

    return { primitiveCalls: calls, hasMutations };
  }

  /**
   * Reset the multi-turn history and persisted namespace.
   */
  reset(): void {
    this.history = [];
    this.persistedNamespace = {};
  }

  /**
   * Get the conversation history (multi-turn mode).
   */
  getHistory(): ConversationTurn[] {
    return [...this.history];
  }

  /**
   * Get the list of primitive methods.
   */
  getPrimitiveNames(): string[] {
    return [...this.primitives.keys()];
  }

  /**
   * Get the list of decomposition examples.
   */
  getDecompositionNames(): string[] {
    return [...this.decompositions.keys()];
  }

  // ============================================================
  // Protected methods (for subclass customization)
  // ============================================================

  /**
   * Build the planning prompt.
   * Override to customize the prompt format.
   */
  protected buildPlanPrompt(task: string, feedback?: string): string {
    const primitiveDocs = formatPrimitiveSignatures(this.primitives, this);
    const examples = formatDecompositionExamples(this.decompositions);

    const parts: string[] = [];

    // System introduction
    parts.push(`You are ${this.name}, an AI agent that generates TypeScript code plans.`);
    if (this.description) {
      parts.push('');
      parts.push(this.description);
    }

    // Available primitives
    parts.push('');
    parts.push('## Available Primitive Methods');
    parts.push('');
    parts.push('You can ONLY call these methods:');
    parts.push('');
    parts.push('```typescript');
    parts.push(primitiveDocs);
    parts.push('```');

    // Decomposition examples
    if (examples) {
      parts.push('');
      parts.push('## Example Decompositions');
      parts.push('');
      parts.push(examples);
    }

    // Multi-turn context
    if (this.config.multiTurn && this.history.length > 0) {
      parts.push('');
      parts.push('## Previous Conversation');
      parts.push('');
      for (const turn of this.history.slice(-10)) {
        // Last 10 turns
        if (turn.role === 'user') {
          parts.push(`User: ${turn.task}`);
        } else {
          if (turn.error) {
            parts.push(`Assistant: Error - ${turn.error}`);
          } else {
            parts.push(`Assistant: Result = ${JSON.stringify(turn.result)}`);
          }
        }
      }

      // Show persisted variables
      const varNames = Object.keys(this.persistedNamespace);
      if (varNames.length > 0) {
        parts.push('');
        parts.push('Available variables from previous turns:');
        for (const name of varNames) {
          const value = this.persistedNamespace[name];
          parts.push(`- ${name} = ${JSON.stringify(value)}`);
        }
      }
    }

    // Task
    parts.push('');
    parts.push('## Task');
    parts.push('');
    parts.push(`Generate TypeScript code to accomplish this task: ${task}`);

    // Feedback from previous attempt
    if (feedback) {
      parts.push('');
      parts.push('## Previous Attempt Failed');
      parts.push('');
      parts.push(feedback);
      parts.push('');
      parts.push('Please fix the issues and try again.');
    }

    // Rules
    parts.push('');
    parts.push('## Rules');
    parts.push('');
    parts.push('1. Output ONLY TypeScript assignment statements (const x = ...)');
    parts.push('2. Each statement must assign a result to a variable');
    parts.push('3. You can ONLY call the primitive methods listed above');
    parts.push('4. Do NOT use imports, loops, conditionals, or function definitions');
    parts.push('5. The last assigned variable will be the final result');
    parts.push('6. Use // for comments, true/false for booleans, null for null values');

    // Output format
    parts.push('');
    parts.push('## Output');
    parts.push('');
    parts.push('```typescript');

    return parts.join('\n');
  }

  /**
   * Extract code from the LLM response.
   * Override to customize extraction.
   */
  protected extractCodeBlock(response: string): string {
    // Try to find a TypeScript code block
    const tsMatch = response.match(/```(?:typescript|ts)\s*([\s\S]*?)```/);
    if (tsMatch) {
      return tsMatch[1].trim();
    }

    // Try to find a JavaScript code block
    const jsMatch = response.match(/```(?:javascript|js)\s*([\s\S]*?)```/);
    if (jsMatch) {
      return jsMatch[1].trim();
    }

    // Try to find any code block
    const codeMatch = response.match(/```\s*([\s\S]*?)```/);
    if (codeMatch) {
      return codeMatch[1].trim();
    }

    // No code block found - try to use the whole response
    // But strip any leading/trailing non-code content
    const lines = response.trim().split('\n');
    const codeLines: string[] = [];

    for (const line of lines) {
      // Skip comment-only lines
      if (/^\s*\/\//.test(line)) {
        continue;
      }
      // Skip lines that look like prose
      if (
        /^[A-Z][a-z].*:$/.test(line) ||
        /^(Here|This|The|I|Let)/.test(line)
      ) {
        continue;
      }
      // Include lines that look like TypeScript assignments
      if (/^\s*(?:const|let)?\s*\w+\s*(?::\s*\w+)?\s*=/.test(line)) {
        codeLines.push(line);
      }
    }

    return codeLines.join('\n').trim();
  }

  /**
   * Hook called after extracting code from LLM response.
   * Override to modify or observe the extracted code.
   */
  protected onCodeExtracted(code: string): string {
    return code;
  }
}
