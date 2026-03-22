/**
 * DesignExecute - Extended PlanExecute with control flow support.
 *
 * Enables plans with for/while/if/try/catch/for-of loops.
 * Adds loop guard injection via the TypeScript transformation API
 * to prevent infinite loops in generated plans.
 *
 * Uses the parent's execute() flow via hooks:
 * - transformSourceFile() for loop guard injection
 * - createInterpreter() for DesignInterpreter
 */

import 'reflect-metadata';
import ts from 'typescript';
import type { LLM, LLMConfig, LLMCache } from './llm/index.js';
import { parsePlan } from './parser/ts-parser.js';
import { validatePlanOrThrow, DEFAULT_ALLOWED_BUILTINS } from './parser/ts-validator.js';
import { injectLoopGuards } from './parser/loop-guard-rewriter.js';
import {
  ExecutionNamespace,
  PlanInterpreter,
  DesignInterpreter,
} from './executor/index.js';
import { PlanExecute, type PlanExecuteConfig } from './plan-execute.js';
import type { DesignExecuteConfig } from './models.js';

export abstract class DesignExecute extends PlanExecute {
  protected designConfig: DesignExecuteConfig;

  constructor(
    llm: LLM | LLMConfig,
    name = '',
    description = '',
    config?: DesignExecuteConfig,
    cache?: LLMCache
  ) {
    const planConfig: PlanExecuteConfig = {
      allowedBuiltins: config?.allowedBuiltins,
      skipResultSerialization: config?.skipResultSerialization,
      multiTurn: config?.multiTurn,
      onMutation: config?.onMutation,
      maxPlanRetries: config?.maxPlanRetries,
      requireMutationApproval: config?.requireMutationApproval,
      workerId: config?.workerId,
    };

    super(llm, name, description, planConfig, cache);
    this.designConfig = config ?? {};
  }

  override validatePlan(planText: string): void {
    const sourceFile = parsePlan(planText);
    const primitiveNames = new Set(this.getPrimitiveNames());
    const builtinNames = new Set([
      ...DEFAULT_ALLOWED_BUILTINS,
      ...Object.keys(this.designConfig.allowedBuiltins ?? {}),
    ]);

    validatePlanOrThrow(sourceFile, {
      primitiveNames,
      allowedBuiltins: builtinNames,
      allowSelfCalls: true,
      allowControlFlow: true,
      allowBreakContinue: this.designConfig.allowBreakContinue ?? true,
    });
  }

  protected override transformSourceFile(sourceFile: ts.SourceFile): ts.SourceFile {
    const enableGuards = this.designConfig.enableLoopGuards ?? true;
    const maxIterations = this.designConfig.maxLoopIterations ?? 1000;
    if (enableGuards) {
      return injectLoopGuards(sourceFile, maxIterations);
    }
    return sourceFile;
  }

  protected override createInterpreter(namespace: ExecutionNamespace): PlanInterpreter {
    const interpreter = new DesignInterpreter(namespace, {
      onMutation: this.config.onMutation,
      skipResultSerialization: this.config.skipResultSerialization,
    });
    const maxCalls = this.designConfig.maxTotalPrimitiveCalls ?? 10000;
    interpreter.setMaxPrimitiveCalls(maxCalls);
    return interpreter;
  }

  protected override getPlanRules(): string[] {
    return [
      '1. Output TypeScript code using assignment statements, loops, and conditionals',
      '2. You can use: const/let, for, for...of, while, if/else, try/catch',
      '3. You can ONLY call the primitive methods listed above',
      '4. Do NOT use imports, class/function declarations, or arrow functions',
      '5. The last assigned variable will be the final result',
      '6. Use // for comments, true/false for booleans, null for null values',
      '7. Loops are guarded — they will throw if they exceed the iteration limit',
    ];
  }
}
