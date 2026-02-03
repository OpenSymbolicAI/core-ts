/**
 * Plan validator to ensure safety of generated plans.
 *
 * Validates that plans only contain:
 * - Assignments to variables (const/let/bare)
 * - Calls to allowed primitives or builtins
 * - Literals, variable references, arrays, and objects
 */

import type { Plan, Expression, Statement } from './ast.js';
import { PlanValidationError } from '../exceptions.js';

/**
 * Result of plan validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Options for plan validation.
 */
export interface ValidationOptions {
  /**
   * Names of primitive methods that can be called.
   */
  primitiveNames: Set<string>;

  /**
   * Names of allowed builtin functions.
   */
  allowedBuiltins: Set<string>;

  /**
   * Whether to allow this.method() calls.
   * If true, 'this.' prefix is stripped and the method name is validated.
   */
  allowSelfCalls?: boolean;
}

/**
 * Validate a plan against a set of allowed primitives and builtins.
 */
export function validatePlan(
  plan: Plan,
  options: ValidationOptions
): ValidationResult {
  const errors: string[] = [];

  for (const stmt of plan.statements) {
    validateStatement(stmt, options, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a plan and throw if invalid.
 */
export function validatePlanOrThrow(
  plan: Plan,
  options: ValidationOptions
): void {
  const result = validatePlan(plan, options);
  if (!result.valid) {
    throw new PlanValidationError(
      `Invalid plan: ${result.errors.join('; ')}`,
      plan.source,
      result.errors
    );
  }
}

function validateStatement(
  stmt: Statement,
  options: ValidationOptions,
  errors: string[]
): void {
  // Validate the variable name
  if (stmt.variable.startsWith('_')) {
    errors.push(
      `Line ${stmt.line}: Variable name '${stmt.variable}' cannot start with underscore`
    );
  }

  // Reserved names that cannot be assigned to
  const reserved = new Set(['this', 'true', 'false', 'null', 'undefined']);
  if (reserved.has(stmt.variable)) {
    errors.push(
      `Line ${stmt.line}: Cannot assign to reserved name '${stmt.variable}'`
    );
  }

  // Validate the expression
  validateExpression(stmt.value, options, errors, stmt.line);
}

function validateExpression(
  expr: Expression,
  options: ValidationOptions,
  errors: string[],
  line: number
): void {
  switch (expr.type) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'null':
    case 'undefined':
      // Literals are always valid
      break;

    case 'identifier':
      // Variable references are valid (runtime will check if defined)
      // But disallow private/dunder access
      if (expr.name.startsWith('__')) {
        errors.push(
          `Line ${line}: Access to dunder name '${expr.name}' is not allowed`
        );
      }
      break;

    case 'list':
      for (const elem of expr.elements) {
        validateExpression(elem, options, errors, line);
      }
      break;

    case 'dict':
      for (const entry of expr.entries) {
        validateExpression(entry.key, options, errors, line);
        validateExpression(entry.value, options, errors, line);
      }
      break;

    case 'attribute':
      // Validate the object part
      validateExpression(expr.object, options, errors, line);

      // Disallow private attribute access
      if (expr.attribute.startsWith('_')) {
        errors.push(
          `Line ${line}: Access to private attribute '${expr.attribute}' is not allowed`
        );
      }
      break;

    case 'call':
      validateCall(expr, options, errors, line);
      break;
  }
}

function validateCall(
  call: Expression & { type: 'call' },
  options: ValidationOptions,
  errors: string[],
  line: number
): void {
  let methodName = call.callee;

  // Handle this.method() calls
  if (methodName.startsWith('this.')) {
    if (!options.allowSelfCalls) {
      errors.push(
        `Line ${line}: 'this.' prefix is not allowed in calls`
      );
      return;
    }
    methodName = methodName.slice(5); // Remove 'this.'
  }

  // Check if it's an allowed call
  const isPrimitive = options.primitiveNames.has(methodName);
  const isBuiltin = options.allowedBuiltins.has(methodName);

  if (!isPrimitive && !isBuiltin) {
    errors.push(
      `Line ${line}: Function '${call.callee}' is not allowed. ` +
        `Only primitives and allowed builtins can be called.`
    );
  }

  // Disallow calls to private/dunder methods
  if (methodName.startsWith('_')) {
    errors.push(
      `Line ${line}: Calls to private methods like '${methodName}' are not allowed`
    );
  }

  // Validate arguments recursively
  for (const arg of call.args) {
    validateExpression(arg, options, errors, line);
  }
  for (const arg of Object.values(call.kwargs)) {
    validateExpression(arg, options, errors, line);
  }
}

/**
 * List of dangerous builtins/globals that should never be allowed.
 * These are JavaScript/Node.js specific dangerous functions.
 */
export const DANGEROUS_BUILTINS = new Set([
  // Code execution
  'eval',
  'Function',

  // Timers (can execute code strings in some environments)
  'setTimeout',
  'setInterval',
  'setImmediate',

  // Node.js specific
  'require',
  'import',
  'process',
  '__dirname',
  '__filename',

  // Browser specific
  'document',
  'window',
  'location',
  'XMLHttpRequest',
  'fetch',

  // Reflection/introspection
  'Reflect',
  'Proxy',

  // Other dangerous globals
  'constructor',
  '__proto__',
  'prototype',
]);

/**
 * Default safe builtins that can be used in plans.
 * These are implemented in the executor namespace.
 */
export const DEFAULT_ALLOWED_BUILTINS = new Set([
  // Array methods (as functions)
  'length',
  'map',
  'filter',
  'reduce',
  'find',
  'findIndex',
  'some',
  'every',
  'includes',
  'indexOf',
  'slice',
  'concat',
  'join',
  'reverse',
  'sort',

  // Type conversion
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',

  // Math utilities
  'Math',
  'abs',
  'min',
  'max',
  'round',
  'floor',
  'ceil',
  'pow',
  'sqrt',

  // Object utilities
  'keys',
  'values',
  'entries',

  // Other safe utilities
  'console',
  'JSON',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
]);
