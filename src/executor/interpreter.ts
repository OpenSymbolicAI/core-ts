/**
 * Plan interpreter that executes parsed plan AST.
 *
 * Instead of using eval(), we interpret the AST directly by:
 * 1. Evaluating expressions recursively
 * 2. Calling primitives through the namespace
 * 3. Managing variable assignments
 */

import type {
  ExecutionStep,
  ArgumentValue,
  MutationHookContext,
} from '../models.js';
import { MutationRejectedError, OperationError } from '../exceptions.js';
import type { Plan, Statement, Expression, CallExpression } from '../parser/ast.js';
import { expressionToString, statementToString } from '../parser/ast.js';
import { ExecutionNamespace } from './namespace.js';

/**
 * Options for the plan interpreter.
 */
export interface InterpreterOptions {
  /**
   * Callback invoked before executing a mutation (non-read-only primitive).
   * Return a string to reject the mutation with that reason.
   * Return null/undefined to allow the mutation.
   */
  onMutation?: (context: MutationHookContext) => string | null | undefined;

  /**
   * Whether to skip result serialization to JSON.
   */
  skipResultSerialization?: boolean;
}

/**
 * Result of interpreting a plan.
 */
export interface InterpretResult {
  steps: ExecutionStep[];
  success: boolean;
  finalValue: unknown;
  finalVariable: string;
}

/**
 * Interprets and executes a parsed plan.
 */
export class PlanInterpreter {
  private namespace: ExecutionNamespace;
  private options: InterpreterOptions;

  constructor(namespace: ExecutionNamespace, options: InterpreterOptions = {}) {
    this.namespace = namespace;
    this.options = options;
  }

  /**
   * Execute a complete plan.
   */
  async execute(plan: Plan): Promise<InterpretResult> {
    const steps: ExecutionStep[] = [];
    let finalValue: unknown = undefined;
    let finalVariable = '';

    for (let i = 0; i < plan.statements.length; i++) {
      const stmt = plan.statements[i];
      const step = await this.executeStatement(stmt, i + 1);
      steps.push(step);

      if (step.success) {
        finalValue = step.resultValue;
        finalVariable = step.variableName;
      } else {
        // Stop execution on failure
        return {
          steps,
          success: false,
          finalValue,
          finalVariable,
        };
      }
    }

    return {
      steps,
      success: true,
      finalValue,
      finalVariable,
    };
  }

  /**
   * Execute a single statement and return the execution step.
   */
  async executeStatement(stmt: Statement, stepNumber: number): Promise<ExecutionStep> {
    const startTime = performance.now();
    const namespaceBefore = this.namespace.serializableSnapshot();
    const statementStr = statementToString(stmt);

    try {
      // Check for mutation hook if this is a call to a non-read-only primitive
      if (stmt.value.type === 'call') {
        const primitiveName = this.resolvePrimitiveName(stmt.value.callee);

        if (
          this.namespace.isPrimitive(primitiveName) &&
          !this.namespace.isReadOnly(primitiveName)
        ) {
          // This is a mutation - check the hook
          if (this.options.onMutation) {
            const args = this.extractArgs(stmt.value);
            const context: MutationHookContext = {
              methodName: primitiveName,
              args,
              statement: statementStr,
              stepNumber,
              currentNamespace: namespaceBefore,
            };

            const rejection = this.options.onMutation(context);
            if (rejection) {
              throw new MutationRejectedError(primitiveName, rejection);
            }
          }
        }
      }

      // Evaluate the expression
      const value = await this.evaluateExpression(stmt.value);

      // Safety check: primitives must not return functions
      if (typeof value === 'function') {
        throw new OperationError(
          `Primitive returned a function, which is not allowed for security reasons`,
          stmt.value.type === 'call' ? stmt.value.callee : 'expression'
        );
      }

      // Assign to variable
      this.namespace.set(stmt.variable, value);

      const elapsed = (performance.now() - startTime) / 1000;
      const namespaceAfter = this.namespace.serializableSnapshot();

      // Extract args for the step record
      const args =
        stmt.value.type === 'call' ? this.buildArgRecord(stmt.value) : {};

      return {
        stepNumber,
        statement: statementStr,
        variableName: stmt.variable,
        primitiveCalled:
          stmt.value.type === 'call'
            ? this.resolvePrimitiveName(stmt.value.callee)
            : null,
        args,
        namespaceBefore,
        namespaceAfter,
        resultType: this.getTypeName(value),
        resultValue: value,
        resultJson: this.safeSerialize(value),
        timeSeconds: elapsed,
        success: true,
        error: null,
      };
    } catch (e) {
      const elapsed = (performance.now() - startTime) / 1000;
      const error = e instanceof Error ? e.message : String(e);

      return {
        stepNumber,
        statement: statementStr,
        variableName: stmt.variable,
        primitiveCalled:
          stmt.value.type === 'call'
            ? this.resolvePrimitiveName(stmt.value.callee)
            : null,
        args: {},
        namespaceBefore,
        namespaceAfter: this.namespace.serializableSnapshot(),
        resultType: '',
        resultValue: undefined,
        resultJson: 'null',
        timeSeconds: elapsed,
        success: false,
        error,
      };
    }
  }

  /**
   * Evaluate an expression and return its value.
   */
  private async evaluateExpression(expr: Expression): Promise<unknown> {
    switch (expr.type) {
      case 'number':
        return expr.value;

      case 'string':
        return expr.value;

      case 'boolean':
        return expr.value;

      case 'null':
        return null;

      case 'undefined':
        return undefined;

      case 'identifier':
        return this.namespace.get(expr.name);

      case 'list':
        return Promise.all(expr.elements.map((e) => this.evaluateExpression(e)));

      case 'dict': {
        const result: Record<string, unknown> = {};
        for (const entry of expr.entries) {
          const key = await this.evaluateExpression(entry.key);
          if (typeof key !== 'string' && typeof key !== 'number') {
            throw new OperationError(
              'Dict keys must be strings or numbers',
              'dict'
            );
          }
          result[String(key)] = await this.evaluateExpression(entry.value);
        }
        return result;
      }

      case 'attribute': {
        const obj = await this.evaluateExpression(expr.object);
        if (obj === null || obj === undefined) {
          throw new OperationError(
            `Cannot access attribute '${expr.attribute}' of ${obj}`,
            'attribute'
          );
        }
        return (obj as Record<string, unknown>)[expr.attribute];
      }

      case 'call':
        return this.executeCall(expr);
    }
  }

  /**
   * Execute a function call.
   */
  private async executeCall(call: CallExpression): Promise<unknown> {
    const fn = this.namespace.get(call.callee);
    if (typeof fn !== 'function') {
      throw new OperationError(`'${call.callee}' is not a function`, call.callee);
    }

    // Evaluate positional arguments
    const args = await Promise.all(call.args.map((arg) => this.evaluateExpression(arg)));

    // Handle keyword arguments
    if (Object.keys(call.kwargs).length > 0) {
      // Python-style kwargs become an options object as the last argument
      const options: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(call.kwargs)) {
        options[key] = await this.evaluateExpression(value);
      }
      return await fn(...args, options);
    }

    return await fn(...args);
  }

  /**
   * Resolve a callee name to a primitive name (strip 'this.' prefix).
   */
  private resolvePrimitiveName(callee: string): string {
    if (callee.startsWith('this.')) {
      return callee.slice(5);
    }
    return callee;
  }

  /**
   * Extract argument values from a call expression.
   */
  private extractArgs(call: CallExpression): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Positional args
    call.args.forEach((arg, i) => {
      try {
        result[`arg${i}`] = this.evaluateExpression(arg);
      } catch {
        result[`arg${i}`] = expressionToString(arg);
      }
    });

    // Keyword args
    for (const [key, value] of Object.entries(call.kwargs)) {
      try {
        result[key] = this.evaluateExpression(value);
      } catch {
        result[key] = expressionToString(value);
      }
    }

    return result;
  }

  /**
   * Build an ArgumentValue record from a call expression.
   */
  private buildArgRecord(call: CallExpression): Record<string, ArgumentValue> {
    const result: Record<string, ArgumentValue> = {};

    // Positional args
    call.args.forEach((arg, i) => {
      const expr = expressionToString(arg);
      let resolvedValue: unknown;
      let variableRef: string | null = null;

      try {
        resolvedValue = this.evaluateExpression(arg);
        if (arg.type === 'identifier') {
          variableRef = arg.name;
        }
      } catch {
        resolvedValue = undefined;
      }

      result[`arg${i}`] = {
        expression: expr,
        resolvedValue,
        variableReference: variableRef,
      };
    });

    // Keyword args
    for (const [key, value] of Object.entries(call.kwargs)) {
      const expr = expressionToString(value);
      let resolvedValue: unknown;
      let variableRef: string | null = null;

      try {
        resolvedValue = this.evaluateExpression(value);
        if (value.type === 'identifier') {
          variableRef = value.name;
        }
      } catch {
        resolvedValue = undefined;
      }

      result[key] = {
        expression: expr,
        resolvedValue,
        variableReference: variableRef,
      };
    }

    return result;
  }

  /**
   * Get a human-readable type name for a value.
   */
  private getTypeName(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Safely serialize a value to JSON.
   */
  private safeSerialize(value: unknown): string {
    if (this.options.skipResultSerialization) {
      return 'null';
    }

    try {
      return JSON.stringify(value);
    } catch {
      return `"<non-serializable: ${this.getTypeName(value)}>"`;
    }
  }
}
