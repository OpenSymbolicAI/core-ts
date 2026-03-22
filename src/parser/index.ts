/**
 * Plan parser for OpenSymbolicAI.
 *
 * Uses the TypeScript Compiler API for true AST analysis.
 * No hand-rolled tokenizer or custom AST types — delegates entirely
 * to the official TypeScript parser and transformation API.
 */

export {
  parsePlan,
  nodeToString,
  getNodeLine,
  getNodePosition,
  resolveCalleeName,
  extractVariableName,
  isVariableStatement,
  isExpressionStatement,
} from './ts-parser.js';

export {
  validatePlan,
  validatePlanOrThrow,
  DANGEROUS_BUILTINS,
  DEFAULT_ALLOWED_BUILTINS,
} from './ts-validator.js';
export type { ValidationResult, PlanValidationIssue, ValidationOptions } from './ts-validator.js';

export { injectLoopGuards } from './loop-guard-rewriter.js';
