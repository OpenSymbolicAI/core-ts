/**
 * Exception hierarchy for OpenSymbolicAI execution errors.
 */

/**
 * Base error class for all execution-related errors.
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

    // Maintains proper stack trace for where our error was thrown (only works in V8)
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

/**
 * Error for input validation failures.
 */
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

/**
 * Error when preconditions are not met before an operation.
 */
export class PreconditionError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PRECONDITION_FAILED', details);
    this.name = 'PreconditionError';
  }
}

/**
 * Error when a required resource is unavailable.
 */
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

/**
 * Error during operation execution.
 */
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

/**
 * Error that can potentially be resolved by retrying.
 */
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

/**
 * Error when plan validation fails.
 */
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

/**
 * Error when plan parsing fails.
 */
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

/**
 * Error when LLM generation fails.
 */
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

/**
 * Error when a mutation is rejected by the approval hook.
 */
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

/**
 * Error when checkpoint operations fail.
 */
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
