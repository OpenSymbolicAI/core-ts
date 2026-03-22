/**
 * PlanExecute - The main class for AI-native plan-and-execute agents.
 *
 * Subclass PlanExecute and define @primitive methods to create an agent.
 * The LLM will generate plans composed of your primitive calls,
 * which are then safely parsed using the TypeScript Compiler API,
 * validated via AST walking, and interpreted without eval().
 */

import 'reflect-metadata';
import ts from 'typescript';
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
import { parsePlan, resolveCalleeName, getNodeLine } from './parser/ts-parser.js';
import { validatePlanOrThrow, DEFAULT_ALLOWED_BUILTINS } from './parser/ts-validator.js';
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

export interface PlanExecuteConfig {
  allowedBuiltins?: Record<string, (...args: unknown[]) => unknown>;
  skipResultSerialization?: boolean;
  multiTurn?: boolean;
  onMutation?: (context: MutationHookContext) => string | null | undefined;
  maxPlanRetries?: number;
  requireMutationApproval?: boolean;
  workerId?: string;
}

export abstract class PlanExecute {
  protected llm: LLM;
  protected config: PlanExecuteConfig;

  protected primitives: Map<string, PrimitiveMetadata>;
  protected decompositions: Map<string, DecompositionMetadata>;
  protected history: ConversationTurn[] = [];
  protected persistedNamespace: Record<string, unknown> = {};

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

    this.primitives = getPrimitives(this);
    this.decompositions = getDecompositions(this);
  }

  // ============================================================
  // Public API
  // ============================================================

  async run(task: string): Promise<OrchestrationResult> {
    const maxRetries = this.config.maxPlanRetries ?? 2;
    const planAttempts: PlanAttempt[] = [];
    let lastPlan = '';
    let lastError = '';

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

        this.validatePlan(planResult.plan);

        const execResult = await this.execute(planResult.plan);
        const allSucceeded = execResult.trace.steps.every((s) => s.success);

        if (this.config.multiTurn) {
          this.history.push({ role: 'user', task, timestamp: new Date() });
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
        } else {
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

    return {
      success: false,
      result: null,
      error: 'Unexpected error in run loop',
      task,
    };
  }

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

  validatePlan(planText: string): void {
    const sourceFile = parsePlan(planText);
    const primitiveNames = new Set(this.primitives.keys());
    const builtinNames = new Set([
      ...DEFAULT_ALLOWED_BUILTINS,
      ...Object.keys(this.config.allowedBuiltins ?? {}),
    ]);

    validatePlanOrThrow(sourceFile, {
      primitiveNames,
      allowedBuiltins: builtinNames,
      allowSelfCalls: true,
      allowControlFlow: false,
    });
  }

  async execute(planText: string): Promise<ExecutionResult> {
    let sourceFile = parsePlan(planText);
    sourceFile = this.transformSourceFile(sourceFile);

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

    const interpreter = this.createInterpreter(namespace);

    const result = await interpreter.execute(sourceFile);

    if (this.config.multiTurn) {
      this.persistedNamespace = namespace.snapshot();
    }

    const trace: ExecutionTrace = {
      steps: result.steps,
      totalTimeSeconds: result.steps.reduce((sum: number, s) => sum + s.timeSeconds, 0),
    };

    return {
      valueType: result.finalValue === undefined ? 'undefined' : typeof result.finalValue === 'object' ? (Array.isArray(result.finalValue) ? 'array' : 'object') : typeof result.finalValue,
      valueName: result.finalVariable,
      valueJson: this.safeSerialize(result.finalValue),
      trace,
    };
  }

  private safeSerialize(value: unknown): string {
    try { return JSON.stringify(value); }
    catch { return 'null'; }
  }

  analyzePlan(planText: string): {
    primitiveCalls: Array<{
      methodName: string;
      args: Record<string, string>;
      statement: string;
      line: number;
    }>;
    hasMutations: boolean;
  } {
    const sourceFile = parsePlan(planText);
    const calls: Array<{
      methodName: string;
      args: Record<string, string>;
      statement: string;
      line: number;
    }> = [];

    let hasMutations = false;

    const visit = (node: ts.Node) => {
      if (ts.isVariableStatement(node)) {
        const decl = node.declarationList.declarations[0];
        if (decl?.initializer && ts.isCallExpression(decl.initializer)) {
          let methodName = resolveCalleeName(decl.initializer.expression, sourceFile);
          if (methodName.startsWith('this.')) {
            methodName = methodName.slice(5);
          }

          const args: Record<string, string> = {};
          decl.initializer.arguments.forEach((arg, i) => {
            args[`arg${i}`] = arg.getText(sourceFile);
          });

          const meta = this.primitives.get(methodName);
          if (meta && !meta.readOnly) {
            hasMutations = true;
          }

          const varName = ts.isIdentifier(decl.name) ? decl.name.text : '?';
          calls.push({
            methodName,
            args,
            statement: `${varName} = ${methodName}(...)`,
            line: getNodeLine(node, sourceFile),
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);

    return { primitiveCalls: calls, hasMutations };
  }

  reset(): void {
    this.history = [];
    this.persistedNamespace = {};
  }

  getHistory(): ConversationTurn[] {
    return [...this.history];
  }

  getPrimitiveNames(): string[] {
    return [...this.primitives.keys()];
  }

  getDecompositionNames(): string[] {
    return [...this.decompositions.keys()];
  }

  // ============================================================
  // Protected methods (for subclass customization)
  // ============================================================

  protected transformSourceFile(sourceFile: ts.SourceFile): ts.SourceFile {
    return sourceFile;
  }

  protected createInterpreter(namespace: ExecutionNamespace): PlanInterpreter {
    return new PlanInterpreter(namespace, {
      onMutation: this.config.onMutation,
      skipResultSerialization: this.config.skipResultSerialization,
    });
  }

  protected buildPlanPrompt(task: string, feedback?: string): string {
    const primitiveDocs = formatPrimitiveSignatures(this.primitives, this);
    const examples = formatDecompositionExamples(this.decompositions);

    const parts: string[] = [];

    parts.push(`You are ${this.name}, an AI agent that generates TypeScript code plans.`);
    if (this.description) {
      parts.push('');
      parts.push(this.description);
    }

    parts.push('');
    parts.push('## Available Primitive Methods');
    parts.push('');
    parts.push('You can ONLY call these methods:');
    parts.push('');
    parts.push('```typescript');
    parts.push(primitiveDocs);
    parts.push('```');

    if (examples) {
      parts.push('');
      parts.push('## Example Decompositions');
      parts.push('');
      parts.push(examples);
    }

    if (this.config.multiTurn && this.history.length > 0) {
      parts.push('');
      parts.push('## Previous Conversation');
      parts.push('');
      for (const turn of this.history.slice(-10)) {
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

    parts.push('');
    parts.push('## Task');
    parts.push('');
    parts.push(`Generate TypeScript code to accomplish this task: ${task}`);

    if (feedback) {
      parts.push('');
      parts.push('## Previous Attempt Failed');
      parts.push('');
      parts.push(feedback);
      parts.push('');
      parts.push('Please fix the issues and try again.');
    }

    parts.push('');
    parts.push('## Rules');
    parts.push('');
    parts.push(...this.getPlanRules());

    parts.push('');
    parts.push('## Output');
    parts.push('');
    parts.push('```typescript');

    return parts.join('\n');
  }

  protected getPlanRules(): string[] {
    return [
      '1. Output ONLY TypeScript assignment statements (const x = ...)',
      '2. Each statement must assign a result to a variable',
      '3. You can ONLY call the primitive methods listed above',
      '4. Do NOT use imports, loops, conditionals, or function definitions',
      '5. The last assigned variable will be the final result',
      '6. Use // for comments, true/false for booleans, null for null values',
    ];
  }

  protected extractCodeBlock(response: string): string {
    const tsMatch = response.match(/```(?:typescript|ts)\s*([\s\S]*?)```/);
    if (tsMatch) return tsMatch[1].trim();

    const jsMatch = response.match(/```(?:javascript|js)\s*([\s\S]*?)```/);
    if (jsMatch) return jsMatch[1].trim();

    const codeMatch = response.match(/```\s*([\s\S]*?)```/);
    if (codeMatch) return codeMatch[1].trim();

    const lines = response.trim().split('\n');
    const codeLines: string[] = [];

    for (const line of lines) {
      if (/^\s*\/\//.test(line)) continue;
      if (/^[A-Z][a-z].*:$/.test(line) || /^(Here|This|The|I|Let)/.test(line)) continue;
      if (/^\s*(?:const|let)?\s*\w+\s*(?::\s*\w+)?\s*=/.test(line)) {
        codeLines.push(line);
      }
    }

    return codeLines.join('\n').trim();
  }

  protected onCodeExtracted(code: string): string {
    return code;
  }
}
