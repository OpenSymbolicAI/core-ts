/**
 * Core decorator system for OpenSymbolicAI.
 *
 * Provides @primitive, @decomposition, and @evaluator decorators that mark methods
 * with metadata used by PlanExecute, DesignExecute, and GoalSeeking classes.
 */

import 'reflect-metadata';
import { MethodType, PrimitiveMetadata, DecompositionMetadata } from './models.js';

const PRIMITIVE_KEY = Symbol('opensymbolicai:primitive');
const DECOMPOSITION_KEY = Symbol('opensymbolicai:decomposition');
const EVALUATOR_KEY = Symbol('opensymbolicai:evaluator');
const METHODS_KEY = Symbol('opensymbolicai:methods');

export interface PrimitiveOptions {
  readOnly?: boolean;
  deterministic?: boolean;
  docstring?: string;
}

export function primitive(options: PrimitiveOptions = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const metadata: PrimitiveMetadata = {
      name: propertyKey,
      readOnly: options.readOnly ?? false,
      deterministic: options.deterministic ?? true,
      docstring: options.docstring,
    };

    Reflect.defineMetadata(PRIMITIVE_KEY, metadata, target, propertyKey);
    registerMethod(target, propertyKey, MethodType.PRIMITIVE);

    return descriptor;
  };
}

export function decomposition(
  intent: string,
  sourceCode: string,
  expandedIntent = ''
) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const metadata: DecompositionMetadata = {
      name: propertyKey,
      intent,
      expandedIntent,
      sourceCode,
    };

    Reflect.defineMetadata(DECOMPOSITION_KEY, metadata, target, propertyKey);
    registerMethod(target, propertyKey, MethodType.DECOMPOSITION);

    return descriptor;
  };
}

/**
 * Decorator that marks a method as the goal evaluator.
 *
 * Used by GoalSeeking to evaluate whether the goal has been achieved.
 * The method must return a GoalEvaluation (or Promise<GoalEvaluation>).
 *
 * Only one method per GoalSeeking subclass can be marked with @evaluator.
 */
export function evaluator() {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    Reflect.defineMetadata(EVALUATOR_KEY, { name: propertyKey }, target, propertyKey);
    registerMethod(target, propertyKey, MethodType.EVALUATOR);
    return descriptor;
  };
}

function registerMethod(
  target: object,
  propertyKey: string,
  methodType: MethodType
): void {
  const methods: Map<string, MethodType> =
    Reflect.getMetadata(METHODS_KEY, target) || new Map();
  methods.set(propertyKey, methodType);
  Reflect.defineMetadata(METHODS_KEY, methods, target);
}

export function getPrimitives(instance: object): Map<string, PrimitiveMetadata> {
  const primitives = new Map<string, PrimitiveMetadata>();
  const proto = Object.getPrototypeOf(instance);

  let currentProto = proto;
  while (currentProto && currentProto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(currentProto)) {
      if (primitives.has(key)) continue;

      const metadata = Reflect.getMetadata(PRIMITIVE_KEY, currentProto, key);
      if (metadata) {
        const method = currentProto[key];
        if (typeof method === 'function') {
          const signature = extractSignature(method, key);
          primitives.set(key, { ...metadata, signature });
        } else {
          primitives.set(key, metadata);
        }
      }
    }
    currentProto = Object.getPrototypeOf(currentProto);
  }

  return primitives;
}

export function getDecompositions(
  instance: object
): Map<string, DecompositionMetadata> {
  const decompositions = new Map<string, DecompositionMetadata>();
  const proto = Object.getPrototypeOf(instance);

  let currentProto = proto;
  while (currentProto && currentProto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(currentProto)) {
      if (decompositions.has(key)) continue;

      const metadata = Reflect.getMetadata(DECOMPOSITION_KEY, currentProto, key);
      if (metadata) {
        decompositions.set(key, metadata);
      }
    }
    currentProto = Object.getPrototypeOf(currentProto);
  }

  return decompositions;
}

/**
 * Get the evaluator method name from a class instance.
 */
export function getEvaluator(instance: object): string | null {
  const proto = Object.getPrototypeOf(instance);

  let currentProto = proto;
  while (currentProto && currentProto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(currentProto)) {
      const metadata = Reflect.getMetadata(EVALUATOR_KEY, currentProto, key);
      if (metadata) {
        return key;
      }
    }
    currentProto = Object.getPrototypeOf(currentProto);
  }

  return null;
}

export function isPrimitive(target: object, propertyKey: string): boolean {
  return Reflect.hasMetadata(PRIMITIVE_KEY, target, propertyKey);
}

export function isDecomposition(target: object, propertyKey: string): boolean {
  return Reflect.hasMetadata(DECOMPOSITION_KEY, target, propertyKey);
}

export function isEvaluator(target: object, propertyKey: string): boolean {
  return Reflect.hasMetadata(EVALUATOR_KEY, target, propertyKey);
}

export function getPrimitiveMetadata(
  target: object,
  propertyKey: string
): PrimitiveMetadata | undefined {
  return Reflect.getMetadata(PRIMITIVE_KEY, target, propertyKey);
}

export function getDecompositionMetadata(
  target: object,
  propertyKey: string
): DecompositionMetadata | undefined {
  return Reflect.getMetadata(DECOMPOSITION_KEY, target, propertyKey);
}

function extractSignature(fn: Function, name: string): string {
  const fnStr = fn.toString();

  const match = fnStr.match(/(?:function\s*\w*\s*)?(\([^)]*\))/);
  if (match) {
    const params = match[1];
    return `${name}${params}`;
  }

  const argCount = fn.length;
  const args = Array.from({ length: argCount }, (_, i) => `arg${i + 1}`).join(', ');
  return `${name}(${args})`;
}

export function formatPrimitiveSignatures(
  primitives: Map<string, PrimitiveMetadata>,
  instance: object
): string {
  const lines: string[] = [];

  for (const [name, metadata] of primitives) {
    const method = (instance as Record<string, unknown>)[name];
    let signature = metadata.signature || `${name}()`;

    if (typeof method === 'function') {
      signature = extractSignature(method, name);
    }

    const annotations: string[] = [];
    if (metadata.readOnly) annotations.push('read-only');
    if (metadata.deterministic === false) annotations.push('non-deterministic');
    const annotationStr = annotations.length > 0 ? ` // ${annotations.join(', ')}` : '';
    const docstring = metadata.docstring || 'Primitive operation';

    lines.push(`/** ${docstring} */${annotationStr}`);
    lines.push(`${signature}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatDecompositionExamples(
  decompositions: Map<string, DecompositionMetadata>
): string {
  const examples: string[] = [];

  for (const [_, metadata] of decompositions) {
    const example: string[] = [];

    example.push(`### Example: ${metadata.intent}`);
    if (metadata.expandedIntent) {
      example.push(`Approach: ${metadata.expandedIntent}`);
    }
    example.push('');
    example.push('```typescript');
    example.push(metadata.sourceCode.trim());
    example.push('```');

    examples.push(example.join('\n'));
  }

  return examples.join('\n\n');
}

// ============================================================
// recordExample - Type-safe decomposition recording
// ============================================================

const RECORDED_VALUE = Symbol('recordedValue');

interface RecordedValue {
  [RECORDED_VALUE]: true;
  expression: string;
}

function isRecordedValue(v: unknown): v is RecordedValue {
  if (v === null || v === undefined) return false;
  if (typeof v !== 'object' && typeof v !== 'function') return false;
  const hasSymbol = Object.prototype.hasOwnProperty.call(v, RECORDED_VALUE);
  return hasSymbol && (v as RecordedValue)[RECORDED_VALUE] === true;
}

function makeRecordedValue(expression: string): RecordedValue {
  return { [RECORDED_VALUE]: true, expression };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExampleProxy = Record<string, any>;

export function recordExample(fn: (proxy: ExampleProxy) => void): string {
  const statements: string[] = [];
  const assignedVars = new Map<string, RecordedValue>();

  const formatArg = (arg: unknown): string => {
    if (isRecordedValue(arg)) {
      return arg.expression;
    }
    if (typeof arg === 'string') {
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(arg)) {
        return arg;
      }
      return `"${arg}"`;
    }
    if (typeof arg === 'number' || typeof arg === 'boolean') {
      return String(arg);
    }
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (Array.isArray(arg)) {
      return `[${arg.map(formatArg).join(', ')}]`;
    }
    if (typeof arg === 'object') {
      const entries = Object.entries(arg)
        .map(([k, v]) => `${k}: ${formatArg(v)}`)
        .join(', ');
      return `{ ${entries} }`;
    }
    return String(arg);
  };

  const createCallableValue = (name: string): ExampleProxy => {
    const callable = (...args: unknown[]) => {
      const argStrings = args.map(formatArg);
      const expression = `${name}(${argStrings.join(', ')})`;
      return makeRecordedValue(expression);
    };

    Object.defineProperty(callable, RECORDED_VALUE, {
      value: true,
      enumerable: false,
    });
    Object.defineProperty(callable, 'expression', {
      value: name,
      enumerable: false,
    });

    return callable as unknown as ExampleProxy;
  };

  const proxy = new Proxy({} as ExampleProxy, {
    get(_, prop: string | symbol): ExampleProxy {
      if (typeof prop === 'symbol') {
        return undefined as unknown as ExampleProxy;
      }

      if (assignedVars.has(prop)) {
        return createCallableValue(prop);
      }

      return createCallableValue(prop);
    },

    set(_, prop: string | symbol, value: unknown): boolean {
      if (typeof prop === 'symbol') {
        return false;
      }

      if (isRecordedValue(value)) {
        statements.push(`const ${prop} = ${value.expression}`);
        assignedVars.set(prop, makeRecordedValue(prop));
      }
      return true;
    },
  });

  fn(proxy);
  return statements.join('\n');
}
