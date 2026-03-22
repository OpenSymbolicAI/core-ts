import { z } from 'zod';

// Token usage tracking
export const TokenUsageSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// Argument value in a primitive call
export const ArgumentValueSchema = z.object({
  expression: z.string(),
  resolvedValue: z.unknown().optional(),
  variableReference: z.string().nullable().default(null),
});
export type ArgumentValue = z.infer<typeof ArgumentValueSchema>;

// Single execution step in a plan
export const ExecutionStepSchema = z.object({
  stepNumber: z.number(),
  statement: z.string(),
  variableName: z.string().default(''),
  primitiveCalled: z.string().nullable().default(null),
  args: z.record(ArgumentValueSchema).default({}),
  namespaceBefore: z.record(z.unknown()).default({}),
  namespaceAfter: z.record(z.unknown()).default({}),
  resultType: z.string().default(''),
  resultValue: z.unknown().optional(),
  resultJson: z.string().default('null'),
  timeSeconds: z.number().default(0),
  success: z.boolean().default(true),
  error: z.string().nullable().default(null),
});
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

// Execution trace containing all steps
export const ExecutionTraceSchema = z.object({
  steps: z.array(ExecutionStepSchema).default([]),
  totalTimeSeconds: z.number().default(0),
});
export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;

// A primitive call extracted from the plan
export const PrimitiveCallSchema = z.object({
  methodName: z.string(),
  positionalArgs: z.array(z.string()).default([]),
  keywordArgs: z.record(z.string()).default({}),
  statement: z.string(),
  lineNumber: z.number().default(0),
});
export type PrimitiveCall = z.infer<typeof PrimitiveCallSchema>;

// Plan analysis result
export const PlanAnalysisSchema = z.object({
  primitiveCalls: z.array(PrimitiveCallSchema).default([]),
  variableNames: z.array(z.string()).default([]),
  hasMutations: z.boolean().default(false),
});
export type PlanAnalysis = z.infer<typeof PlanAnalysisSchema>;

// LLM generation details
export const PlanGenerationSchema = z.object({
  prompt: z.string(),
  rawResponse: z.string(),
  extractedCode: z.string(),
  usage: TokenUsageSchema.default({ inputTokens: 0, outputTokens: 0 }),
});
export type PlanGeneration = z.infer<typeof PlanGenerationSchema>;

// Plan result from the planning phase
export const PlanResultSchema = z.object({
  plan: z.string(),
  usage: TokenUsageSchema.default({ inputTokens: 0, outputTokens: 0 }),
  timeSeconds: z.number().default(0),
  provider: z.string().default(''),
  model: z.string().default(''),
  planGeneration: PlanGenerationSchema.optional(),
});
export type PlanResult = z.infer<typeof PlanResultSchema>;

// Execution result
export const ExecutionResultSchema = z.object({
  valueType: z.string(),
  valueName: z.string(),
  valueJson: z.string(),
  trace: ExecutionTraceSchema,
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

// Orchestration metrics
export const OrchestrationMetricsSchema = z.object({
  planTokens: TokenUsageSchema.optional(),
  planTimeSeconds: z.number().optional(),
  executeTimeSeconds: z.number().optional(),
  stepsExecuted: z.number().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
});
export type OrchestrationMetrics = z.infer<typeof OrchestrationMetricsSchema>;

// Plan attempt (for retry tracking)
export const PlanAttemptSchema = z.object({
  attemptNumber: z.number(),
  plan: z.string(),
  validationError: z.string().nullable().default(null),
  feedback: z.string().nullable().default(null),
});
export type PlanAttempt = z.infer<typeof PlanAttemptSchema>;

// Full orchestration result
export const OrchestrationResultSchema = z.object({
  success: z.boolean(),
  result: z.unknown().nullable(),
  error: z.string().nullable().default(null),
  metrics: OrchestrationMetricsSchema.optional(),
  plan: z.string().optional(),
  trace: ExecutionTraceSchema.optional(),
  planAttempts: z.array(PlanAttemptSchema).optional(),
  task: z.string(),
});
export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;

// Conversation turn for multi-turn mode
export const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  task: z.string(),
  plan: z.string().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  timestamp: z.date().default(() => new Date()),
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

// Mutation hook context
export const MutationHookContextSchema = z.object({
  methodName: z.string(),
  args: z.record(z.unknown()),
  statement: z.string(),
  stepNumber: z.number(),
  currentNamespace: z.record(z.unknown()),
});
export type MutationHookContext = z.infer<typeof MutationHookContextSchema>;

// Pending mutation (for checkpoint approval workflow)
export const PendingMutationSchema = z.object({
  methodName: z.string(),
  args: z.record(z.unknown()),
  statement: z.string(),
  stepNumber: z.number(),
});
export type PendingMutation = z.infer<typeof PendingMutationSchema>;

// Checkpoint status enum
export const CheckpointStatusSchema = z.enum([
  'pending',
  'running',
  'paused',
  'awaiting_approval',
  'completed',
  'failed',
]);
export type CheckpointStatus = z.infer<typeof CheckpointStatusSchema>;

// Serialized value for checkpoint persistence
export interface SerializedValue {
  type: string;
  value: unknown;
  serializable: boolean;
}

export const SerializedValueSchema: z.ZodType<SerializedValue> = z.object({
  type: z.string(),
  value: z.unknown(),
  serializable: z.boolean(),
}) as z.ZodType<SerializedValue>;

// Plan context for checkpoint
export const PlanContextSchema = z.object({
  prompt: z.string(),
  rawResponse: z.string(),
  extractedCode: z.string(),
  usage: TokenUsageSchema.default({ inputTokens: 0, outputTokens: 0 }),
  timeSeconds: z.number().default(0),
});
export type PlanContext = z.infer<typeof PlanContextSchema>;

// Execution checkpoint for distributed execution
export const ExecutionCheckpointSchema = z.object({
  checkpointId: z.string(),
  task: z.string(),
  plan: z.string(),
  planContext: PlanContextSchema.optional(),
  currentStep: z.number().default(0),
  totalSteps: z.number().default(0),
  status: CheckpointStatusSchema.default('pending'),
  completedSteps: z.array(ExecutionStepSchema).default([]),
  namespaceSnapshot: z.record(z.unknown()).default({}),
  pendingMutation: PendingMutationSchema.nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
  workerId: z.string().nullable().default(null),
  resultValue: z.unknown().nullable().default(null),
  resultVariable: z.string().nullable().default(null),
});
export type ExecutionCheckpoint = z.infer<typeof ExecutionCheckpointSchema>;

// Primitive method metadata
export interface PrimitiveMetadata {
  name: string;
  readOnly: boolean;
  deterministic?: boolean;
  docstring?: string;
  signature?: string;
}

// Decomposition method metadata
export interface DecompositionMetadata {
  name: string;
  intent: string;
  expandedIntent: string;
  sourceCode: string;
}

// Method type enum
export enum MethodType {
  PRIMITIVE = 'primitive',
  DECOMPOSITION = 'decomposition',
  EVALUATOR = 'evaluator',
}

// ============================================================
// DesignExecute types
// ============================================================

export interface DesignExecuteConfig {
  maxLoopIterations?: number;
  maxTotalPrimitiveCalls?: number;
  enableLoopGuards?: boolean;
  allowBreakContinue?: boolean;
  allowedBuiltins?: Record<string, (...args: unknown[]) => unknown>;
  skipResultSerialization?: boolean;
  multiTurn?: boolean;
  onMutation?: (context: MutationHookContext) => string | null | undefined;
  maxPlanRetries?: number;
  requireMutationApproval?: boolean;
  workerId?: string;
}

// ============================================================
// GoalSeeking types
// ============================================================

export interface GoalContext {
  goal: string;
  currentState: string;
  iterationCount: number;
  observations: string[];
}

export const GoalEvaluationSchema = z.object({
  achieved: z.boolean(),
  confidence: z.number().min(0).max(1).default(0),
  reasoning: z.string(),
  suggestedNextAction: z.string().optional(),
  metrics: z.record(z.unknown()).optional(),
});
export type GoalEvaluation = z.infer<typeof GoalEvaluationSchema>;

export const GoalIterationSchema = z.object({
  iterationNumber: z.number(),
  plan: z.string().optional(),
  executionResult: OrchestrationResultSchema.optional(),
  evaluation: GoalEvaluationSchema,
  contextSnapshot: z.record(z.unknown()).default({}),
  timeSeconds: z.number().default(0),
});
export type GoalIteration = z.infer<typeof GoalIterationSchema>;

export interface GoalSeekingConfig extends DesignExecuteConfig {
  maxGoalIterations?: number;
  confidenceThreshold?: number;
}

export const GoalSeekingResultSchema = z.object({
  achieved: z.boolean(),
  iterations: z.array(GoalIterationSchema).default([]),
  finalEvaluation: GoalEvaluationSchema.optional(),
  finalContext: z.record(z.unknown()).default({}),
  totalTimeSeconds: z.number().default(0),
  totalTokens: TokenUsageSchema.default({ inputTokens: 0, outputTokens: 0 }),
});
export type GoalSeekingResult = z.infer<typeof GoalSeekingResultSchema>;

// ============================================================
// Observability types
// ============================================================

export enum EventType {
  RunStarted = 'run.started',
  RunCompleted = 'run.completed',
  RunFailed = 'run.failed',
  PlanStarted = 'plan.started',
  PlanLlmRequest = 'plan.llm_request',
  PlanLlmResponse = 'plan.llm_response',
  PlanGenerated = 'plan.generated',
  PlanValidationFailed = 'plan.validation_failed',
  PlanRetry = 'plan.retry',
  ExecutionStarted = 'execution.started',
  ExecutionStepStarted = 'execution.step_started',
  ExecutionStepCompleted = 'execution.step_completed',
  ExecutionStepFailed = 'execution.step_failed',
  ExecutionCompleted = 'execution.completed',
  ExecutionFailed = 'execution.failed',
  MutationRequested = 'mutation.requested',
  MutationApproved = 'mutation.approved',
  MutationRejected = 'mutation.rejected',
  LoopGuardTriggered = 'loop_guard.triggered',
  GoalSeekStarted = 'goal.seek_started',
  GoalIterationStarted = 'goal.iteration_started',
  GoalIterationCompleted = 'goal.iteration_completed',
  GoalEvaluated = 'goal.evaluated',
  GoalAchieved = 'goal.achieved',
  GoalSeekCompleted = 'goal.seek_completed',
  GoalSeekFailed = 'goal.seek_failed',
  Error = 'error',
}

export const TraceEventSchema = z.object({
  eventType: z.nativeEnum(EventType),
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  timestamp: z.date().default(() => new Date()),
  duration: z.number().optional(),
  data: z.record(z.unknown()).default({}),
  tags: z.record(z.string()).optional(),
});
export type TraceEvent = z.infer<typeof TraceEventSchema>;

export interface ITraceTransport {
  emit(event: TraceEvent): void | Promise<void>;
  flush(): Promise<void>;
}

export interface ObservabilityConfig {
  enabled: boolean;
  transports: ITraceTransport[];
  captureLlmPrompts?: boolean;
  captureNamespaceSnapshots?: boolean;
}
