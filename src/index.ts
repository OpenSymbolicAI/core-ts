/**
 * OpenSymbolicAI - TypeScript Implementation
 *
 * AI-native programming framework where agents define primitive methods
 * and decomposition examples, and an LLM generates execution plans
 * composed entirely of primitive calls.
 *
 * Uses the TypeScript Compiler API for true AST analysis — parsing,
 * validation, loop guard injection, and safe interpretation all use
 * the official TypeScript toolchain.
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
 *   @decomposition('Calculate sum', 'const result = add(2, 3)')
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

// Core blueprints
export { PlanExecute } from './plan-execute.js';
export type { PlanExecuteConfig } from './plan-execute.js';

export { DesignExecute } from './design-execute.js';

export { GoalSeeking } from './goal-seeking.js';

// Decorators and metadata
export {
  primitive,
  decomposition,
  evaluator,
  recordExample,
  getPrimitives,
  getDecompositions,
  getEvaluator,
  isPrimitive,
  isDecomposition,
  isEvaluator,
  getPrimitiveMetadata,
  getDecompositionMetadata,
  formatPrimitiveSignatures,
  formatDecompositionExamples,
} from './core.js';
export type { PrimitiveOptions, ExampleProxy } from './core.js';

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
  GoalEvaluationSchema,
  GoalIterationSchema,
  GoalSeekingResultSchema,
  TraceEventSchema,
  MethodType,
  EventType,
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
  DesignExecuteConfig,
  GoalContext,
  GoalEvaluation,
  GoalIteration,
  GoalSeekingConfig,
  GoalSeekingResult,
  TraceEvent,
  ITraceTransport,
  ObservabilityConfig,
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
  LoopGuardError,
  GoalSeekingError,
  MaxPrimitiveCallsError,
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

// Parser (TypeScript Compiler API-based)
export {
  parsePlan,
  nodeToString,
  getNodeLine,
  getNodePosition,
  resolveCalleeName,
  extractVariableName,
  isVariableStatement,
  isExpressionStatement,
  validatePlan,
  validatePlanOrThrow,
  DANGEROUS_BUILTINS,
  DEFAULT_ALLOWED_BUILTINS,
  injectLoopGuards,
} from './parser/index.js';
export type {
  ValidationResult,
  PlanValidationIssue,
  ValidationOptions,
} from './parser/index.js';

// Executor
export {
  ExecutionNamespace,
  DEFAULT_BUILTINS,
  PlanInterpreter,
  DesignInterpreter,
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
  createCheckpointId,
} from './checkpoint/index.js';
export type {
  Serializer,
  Deserializer,
  CheckpointStore,
} from './checkpoint/index.js';

// Observability
export {
  Tracer,
  Span,
  InMemoryTransport,
  HttpTransport,
} from './observability/index.js';
