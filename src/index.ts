/**
 * OpenSymbolicAI - TypeScript Implementation
 *
 * AI-native programming framework where agents define primitive methods
 * and decomposition examples, and an LLM generates execution plans
 * composed entirely of primitive calls.
 *
 * @example
 * ```typescript
 * import { PlanExecute, primitive, decomposition, LLMConfig } from '@opensymbolicai/core';
 *
 * class Calculator extends PlanExecute {
 *   @primitive({ readOnly: true })
 *   add(a: number, b: number): number {
 *     return a + b;
 *   }
 *
 *   @decomposition('Calculate sum', 'result = add(a, b)')
 *   _exampleSum() {}
 * }
 *
 * const calc = new Calculator(
 *   { provider: 'openai', model: 'gpt-4', params: { temperature: 0 } },
 *   'Calculator',
 *   'A simple calculator'
 * );
 *
 * const result = await calc.run('Add 2 and 3');
 * console.log(result.result); // 5
 * ```
 */

// Core
export { PlanExecute } from './plan-execute.js';
export type { PlanExecuteConfig } from './plan-execute.js';

export {
  primitive,
  decomposition,
  getPrimitives,
  getDecompositions,
  isPrimitive,
  isDecomposition,
  getPrimitiveMetadata,
  getDecompositionMetadata,
  formatPrimitiveSignatures,
  formatDecompositionExamples,
} from './core.js';
export type { PrimitiveOptions } from './core.js';

// Models
export {
  TokenUsageSchema,
  ArgumentValueSchema,
  ExecutionStepSchema,
  ExecutionTraceSchema,
  PrimitiveCallSchema,
  PlanAnalysisSchema,
  PlanGenerationSchema,
  PlanResultSchema,
  ExecutionResultSchema,
  OrchestrationMetricsSchema,
  PlanAttemptSchema,
  OrchestrationResultSchema,
  ConversationTurnSchema,
  MutationHookContextSchema,
  PendingMutationSchema,
  CheckpointStatusSchema,
  SerializedValueSchema,
  PlanContextSchema,
  ExecutionCheckpointSchema,
  MethodType,
} from './models.js';
export type {
  TokenUsage,
  ArgumentValue,
  ExecutionStep,
  ExecutionTrace,
  PrimitiveCall,
  PlanAnalysis,
  PlanGeneration,
  PlanResult,
  ExecutionResult,
  OrchestrationMetrics,
  PlanAttempt,
  OrchestrationResult,
  ConversationTurn,
  MutationHookContext,
  PendingMutation,
  CheckpointStatus,
  SerializedValue,
  PlanContext,
  ExecutionCheckpoint,
  PrimitiveMetadata,
  DecompositionMetadata,
} from './models.js';

// Exceptions
export {
  ExecutionError,
  ValidationError,
  PreconditionError,
  ResourceError,
  OperationError,
  RetryableError,
  PlanValidationError,
  PlanParseError,
  LLMError,
  MutationRejectedError,
  CheckpointError,
} from './exceptions.js';

// LLM
export {
  LLM,
  OpenAILLM,
  AnthropicLLM,
  OllamaLLM,
  FireworksLLM,
  GroqLLM,
  createLLM,
  isLLM,
  InMemoryCache,
  NullCache,
  computeCacheKey,
  ProviderSchema,
  GenerationParamsSchema,
  LLMConfigSchema,
  toOpenAIParams,
  toAnthropicParams,
  toOllamaParams,
} from './llm/index.js';
export type {
  Provider,
  GenerationParams,
  LLMConfig,
  LLMResponse,
  LLMCache,
  LLMCacheEntry,
} from './llm/index.js';

// Parser
export {
  PlanParser,
  tokenize,
  TokenType,
  validatePlan,
  validatePlanOrThrow,
  DANGEROUS_BUILTINS,
  DEFAULT_ALLOWED_BUILTINS,
  isLiteral,
  isCall,
  isIdentifier,
  expressionToString,
  statementToString,
} from './parser/index.js';
export type {
  Token,
  ValidationResult,
  ValidationOptions,
  Literal,
  NumberLiteral,
  StringLiteral,
  BooleanLiteral,
  NullLiteral,
  Identifier,
  ListExpression,
  DictExpression,
  AttributeAccess,
  CallExpression,
  Expression,
  Assignment,
  Statement,
  Plan,
} from './parser/index.js';

// Executor
export {
  ExecutionNamespace,
  DEFAULT_BUILTINS,
  PlanInterpreter,
} from './executor/index.js';
export type {
  NamespaceOptions,
  InterpreterOptions,
  InterpretResult,
} from './executor/index.js';

// Checkpoint
export {
  SerializerRegistry,
  defaultRegistry,
  InMemoryCheckpointStore,
  FileCheckpointStore,
  createCheckpointId,
} from './checkpoint/index.js';
export type {
  Serializer,
  Deserializer,
  CheckpointStore,
} from './checkpoint/index.js';
