/**
 * Exception hierarchy for OpenSymbolicAI execution errors.
 */

export class ExecutionError extends Error {
  public readonly code?: string;
  public readonly details: Record<string, unknown>;
  public readonly haltExecution: boolean;

  constructor(
    message: string,
    code?: string,
    details: Record<string, unknown> = {},
    haltExecution = true
  ) {
    super(message);
    this.name = 'ExecutionError';
    this.code = code;
    this.details = details;
    this.haltExecution = haltExecution;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toDict(): Record<string, unknown> {
    return {
      type: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      haltExecution: this.haltExecution,
    };
  }
}

export class ValidationError extends ExecutionError {
  public readonly field?: string;

  constructor(
    message: string,
    field?: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'VALIDATION_ERROR', { ...details, field });
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class PreconditionError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PRECONDITION_FAILED', details);
    this.name = 'PreconditionError';
  }
}

export class ResourceError extends ExecutionError {
  public readonly resourceType: string;
  public readonly resourceId?: string;

  constructor(
    message: string,
    resourceType: string,
    resourceId?: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'RESOURCE_ERROR', { ...details, resourceType, resourceId });
    this.name = 'ResourceError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

export class OperationError extends ExecutionError {
  public readonly operationName: string;

  constructor(
    message: string,
    operationName: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'OPERATION_ERROR', { ...details, operationName });
    this.name = 'OperationError';
    this.operationName = operationName;
  }
}

export class RetryableError extends ExecutionError {
  public readonly maxRetries: number;
  public readonly currentAttempt: number;

  constructor(
    message: string,
    maxRetries: number,
    currentAttempt: number,
    details?: Record<string, unknown>
  ) {
    super(message, 'RETRYABLE_ERROR', { ...details, maxRetries, currentAttempt }, false);
    this.name = 'RetryableError';
    this.maxRetries = maxRetries;
    this.currentAttempt = currentAttempt;
  }

  get canRetry(): boolean {
    return this.currentAttempt < this.maxRetries;
  }
}

export class PlanValidationError extends ExecutionError {
  public readonly planText: string;
  public readonly validationErrors: string[];

  constructor(
    message: string,
    planText: string,
    validationErrors: string[],
    details?: Record<string, unknown>
  ) {
    super(message, 'PLAN_VALIDATION_ERROR', { ...details, validationErrors });
    this.name = 'PlanValidationError';
    this.planText = planText;
    this.validationErrors = validationErrors;
  }
}

export class PlanParseError extends ExecutionError {
  public readonly planText: string;
  public readonly line?: number;
  public readonly column?: number;

  constructor(
    message: string,
    planText: string,
    line?: number,
    column?: number,
    details?: Record<string, unknown>
  ) {
    super(message, 'PLAN_PARSE_ERROR', { ...details, line, column });
    this.name = 'PlanParseError';
    this.planText = planText;
    this.line = line;
    this.column = column;
  }
}

export class LLMError extends ExecutionError {
  public readonly provider: string;
  public readonly model: string;
  public readonly statusCode?: number;

  constructor(
    message: string,
    provider: string,
    model: string,
    statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(message, 'LLM_ERROR', { ...details, provider, model, statusCode });
    this.name = 'LLMError';
    this.provider = provider;
    this.model = model;
    this.statusCode = statusCode;
  }
}

export class MutationRejectedError extends ExecutionError {
  public readonly methodName: string;
  public readonly reason: string;

  constructor(
    methodName: string,
    reason: string,
    details?: Record<string, unknown>
  ) {
    super(`Mutation '${methodName}' rejected: ${reason}`, 'MUTATION_REJECTED', {
      ...details,
      methodName,
      reason,
    });
    this.name = 'MutationRejectedError';
    this.methodName = methodName;
    this.reason = reason;
  }
}

export class CheckpointError extends ExecutionError {
  public readonly checkpointId?: string;

  constructor(
    message: string,
    checkpointId?: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'CHECKPOINT_ERROR', { ...details, checkpointId });
    this.name = 'CheckpointError';
    this.checkpointId = checkpointId;
  }
}

/**
 * Error when a loop guard triggers (exceeded max iterations).
 */
export class LoopGuardError extends ExecutionError {
  public readonly maxIterations: number;

  constructor(maxIterations: number, details?: Record<string, unknown>) {
    super(
      `Loop guard: exceeded ${maxIterations} iterations`,
      'LOOP_GUARD_ERROR',
      { ...details, maxIterations }
    );
    this.name = 'LoopGuardError';
    this.maxIterations = maxIterations;
  }
}

/**
 * Error when goal seeking fails or exceeds iterations.
 */
export class GoalSeekingError extends ExecutionError {
  public readonly iterationsCompleted: number;

  constructor(
    message: string,
    iterationsCompleted: number,
    details?: Record<string, unknown>
  ) {
    super(message, 'GOAL_SEEKING_ERROR', { ...details, iterationsCompleted });
    this.name = 'GoalSeekingError';
    this.iterationsCompleted = iterationsCompleted;
  }
}

/**
 * Error when total primitive call limit is exceeded.
 */
export class MaxPrimitiveCallsError extends ExecutionError {
  public readonly maxCalls: number;

  constructor(maxCalls: number, details?: Record<string, unknown>) {
    super(
      `Exceeded maximum total primitive calls (${maxCalls})`,
      'MAX_PRIMITIVE_CALLS_ERROR',
      { ...details, maxCalls }
    );
    this.name = 'MaxPrimitiveCallsError';
    this.maxCalls = maxCalls;
  }
}
