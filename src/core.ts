/**
 * Core decorator system for OpenSymbolicAI.
 *
 * Provides @primitive and @decomposition decorators that mark methods
 * with metadata used by the PlanExecute class for plan generation and execution.
 */

import 'reflect-metadata';
import { MethodType, PrimitiveMetadata, DecompositionMetadata } from './models.js';

// Metadata keys for storing decorator information
const PRIMITIVE_KEY = Symbol('opensymbolicai:primitive');
const DECOMPOSITION_KEY = Symbol('opensymbolicai:decomposition');
const METHODS_KEY = Symbol('opensymbolicai:methods');

/**
 * Options for the @primitive decorator.
 */
export interface PrimitiveOptions {
  /**
   * Whether this primitive is read-only (doesn't mutate state).
   * Read-only primitives don't require mutation approval in stepwise execution.
   */
  readOnly?: boolean;

  /**
   * Optional docstring describing the primitive.
   * If not provided, extracted from JSDoc if available.
   */
  docstring?: string;
}

/**
 * Decorator that marks a method as a primitive operation.
 *
 * Primitives are the atomic operations that the LLM can call in generated plans.
 * They should be simple, well-documented methods with clear inputs and outputs.
 *
 * @example
 * ```typescript
 * class Calculator extends PlanExecute {
 *   @primitive({ readOnly: true })
 *   add(a: number, b: number): number {
 *     return a + b;
 *   }
 *
 *   @primitive({ readOnly: false })
 *   storeResult(value: number): void {
 *     this.memory = value;
 *   }
 * }
 * ```
 */
export function primitive(options: PrimitiveOptions = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const metadata: PrimitiveMetadata = {
      name: propertyKey,
      readOnly: options.readOnly ?? false,
      docstring: options.docstring,
    };

    // Store metadata on the method
    Reflect.defineMetadata(PRIMITIVE_KEY, metadata, target, propertyKey);

    // Track this method in the class's method registry
    registerMethod(target, propertyKey, MethodType.PRIMITIVE);

    return descriptor;
  };
}

/**
 * Decorator that marks a method as a decomposition example.
 *
 * Decomposition examples show the LLM how to break down complex tasks
 * into sequences of primitive calls. They're used as few-shot examples
 * in the planning prompt.
 *
 * @param intent - A high-level description of what this decomposition accomplishes
 * @param sourceCode - The TypeScript code showing the decomposition (use recordExample() helper)
 * @param expandedIntent - Optional more detailed description of the approach
 *
 * @example
 * ```typescript
 * class Calculator extends PlanExecute {
 *   @decomposition(
 *     'Calculate the area of a circle',
 *     recordExample(calc => {
 *       calc.radius_squared = calc.multiply(calc.radius, calc.radius);
 *       calc.area = calc.multiply(calc.radius_squared, 3.14159);
 *     }),
 *     'Use formula: π * r²'
 *   )
 *   _exampleCircleArea() {}
 * }
 * ```
 */
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

    // Store metadata on the method
    Reflect.defineMetadata(DECOMPOSITION_KEY, metadata, target, propertyKey);

    // Track this method in the class's method registry
    registerMethod(target, propertyKey, MethodType.DECOMPOSITION);

    return descriptor;
  };
}

/**
 * Register a method in the class's method registry.
 */
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

/**
 * Get all primitive methods from a class instance.
 *
 * @param instance - The object instance to inspect
 * @returns Map of method names to their metadata
 */
export function getPrimitives(instance: object): Map<string, PrimitiveMetadata> {
  const primitives = new Map<string, PrimitiveMetadata>();
  const proto = Object.getPrototypeOf(instance);

  // Walk the prototype chain to find all primitives (including inherited ones)
  let currentProto = proto;
  while (currentProto && currentProto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(currentProto)) {
      if (primitives.has(key)) continue; // Don't override with parent's version

      const metadata = Reflect.getMetadata(PRIMITIVE_KEY, currentProto, key);
      if (metadata) {
        // Try to extract signature from the method
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

/**
 * Get all decomposition methods from a class instance.
 *
 * @param instance - The object instance to inspect
 * @returns Map of method names to their metadata
 */
export function getDecompositions(
  instance: object
): Map<string, DecompositionMetadata> {
  const decompositions = new Map<string, DecompositionMetadata>();
  const proto = Object.getPrototypeOf(instance);

  // Walk the prototype chain
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
 * Check if a method is a primitive.
 */
export function isPrimitive(target: object, propertyKey: string): boolean {
  return Reflect.hasMetadata(PRIMITIVE_KEY, target, propertyKey);
}

/**
 * Check if a method is a decomposition.
 */
export function isDecomposition(target: object, propertyKey: string): boolean {
  return Reflect.hasMetadata(DECOMPOSITION_KEY, target, propertyKey);
}

/**
 * Get primitive metadata for a specific method.
 */
export function getPrimitiveMetadata(
  target: object,
  propertyKey: string
): PrimitiveMetadata | undefined {
  return Reflect.getMetadata(PRIMITIVE_KEY, target, propertyKey);
}

/**
 * Get decomposition metadata for a specific method.
 */
export function getDecompositionMetadata(
  target: object,
  propertyKey: string
): DecompositionMetadata | undefined {
  return Reflect.getMetadata(DECOMPOSITION_KEY, target, propertyKey);
}

/**
 * Extract a function signature from a method.
 * This is a best-effort extraction since TypeScript doesn't preserve
 * parameter names at runtime.
 */
function extractSignature(fn: Function, name: string): string {
  const fnStr = fn.toString();

  // Try to extract parameters from the function string
  const match = fnStr.match(/(?:function\s*\w*\s*)?(\([^)]*\))/);
  if (match) {
    const params = match[1];
    return `${name}${params}`;
  }

  // Fallback: use the function length to show arity
  const argCount = fn.length;
  const args = Array.from({ length: argCount }, (_, i) => `arg${i + 1}`).join(', ');
  return `${name}(${args})`;
}

/**
 * Format primitives for inclusion in the planning prompt.
 *
 * @param primitives - Map of primitive names to metadata
 * @param instance - The agent instance (to get actual method references)
 * @returns Formatted string describing all primitives
 */
export function formatPrimitiveSignatures(
  primitives: Map<string, PrimitiveMetadata>,
  instance: object
): string {
  const lines: string[] = [];

  for (const [name, metadata] of primitives) {
    const method = (instance as Record<string, unknown>)[name];
    let signature = metadata.signature || `${name}()`;

    // Try to get better signature from the method
    if (typeof method === 'function') {
      signature = extractSignature(method, name);
    }

    // Format as TypeScript method
    const readOnlyNote = metadata.readOnly ? ' // read-only' : '';
    const docstring = metadata.docstring || 'Primitive operation';

    lines.push(`/** ${docstring} */${readOnlyNote}`);
    lines.push(`${signature}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format decomposition examples for inclusion in the planning prompt.
 *
 * @param decompositions - Map of decomposition names to metadata
 * @returns Formatted string with all examples
 */
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

/** Symbol to identify recorded values */
const RECORDED_VALUE = Symbol('recordedValue');

/** A symbolic value representing a variable or expression in the recorded example */
interface RecordedValue {
  [RECORDED_VALUE]: true;
  expression: string;
}

function isRecordedValue(v: unknown): v is RecordedValue {
  if (v === null || v === undefined) return false;
  // Check both objects and functions (callables are functions with the symbol attached)
  if (typeof v !== 'object' && typeof v !== 'function') return false;
  // Use Object.prototype.hasOwnProperty to check for the symbol
  const hasSymbol = Object.prototype.hasOwnProperty.call(v, RECORDED_VALUE);
  return hasSymbol && (v as RecordedValue)[RECORDED_VALUE] === true;
}

function makeRecordedValue(expression: string): RecordedValue {
  return { [RECORDED_VALUE]: true, expression };
}

/**
 * Type for the proxy object passed to recordExample callbacks.
 * Allows both property access (for variables) and method calls (for primitives).
 *
 * Each property can be:
 * - Called as a function: `proxy.multiply(a, b)` - records a primitive call
 * - Assigned to: `proxy.result = proxy.add(1, 2)` - records an assignment
 * - Used as a value: `proxy.multiply(proxy.x, proxy.y)` - references an input variable
 *
 * Note: We use `any` here because TypeScript's type system cannot fully express
 * the dynamic proxy behavior where every property is both callable and assignable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExampleProxy = Record<string, any>;

/**
 * Record a decomposition example using method call syntax instead of string literals.
 *
 * This provides a more type-safe and refactor-friendly way to write decomposition
 * examples. The proxy captures all method calls and variable assignments, converting
 * them to TypeScript-style source code for use in prompts.
 *
 * @param fn - A function that uses the proxy to demonstrate the decomposition
 * @returns The recorded source code as a string
 *
 * @example
 * ```typescript
 * @decomposition(
 *   'Calculate the area of a circle given radius',
 *   recordExample(calc => {
 *     calc.radius_squared = calc.multiply(calc.radius, calc.radius);
 *     calc.area = calc.multiply(calc.radius_squared, 3.14159);
 *   }),
 *   'Use formula: π * r²'
 * )
 * _exampleCircleArea() {}
 * ```
 *
 * This produces:
 * ```typescript
 * const radius_squared = multiply(radius, radius)
 * const area = multiply(radius_squared, 3.14159)
 * ```
 */
export function recordExample(fn: (proxy: ExampleProxy) => void): string {
  const statements: string[] = [];
  const assignedVars = new Map<string, RecordedValue>();

  const formatArg = (arg: unknown): string => {
    if (isRecordedValue(arg)) {
      return arg.expression;
    }
    if (typeof arg === 'string') {
      // Check if it looks like a variable name (identifier) or a string literal
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(arg)) {
        return arg; // Treat as variable reference
      }
      return `"${arg}"`; // Treat as string literal
    }
    if (typeof arg === 'number' || typeof arg === 'boolean') {
      return String(arg);
    }
    if (arg === null) {
      return 'null';
    }
    if (arg === undefined) {
      return 'undefined';
    }
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
    // Create a function that records method calls
    const callable = (...args: unknown[]) => {
      const argStrings = args.map(formatArg);
      const expression = `${name}(${argStrings.join(', ')})`;
      return makeRecordedValue(expression);
    };

    // Also make it usable as a value (for input variables like calc.radius)
    Object.defineProperty(callable, RECORDED_VALUE, {
      value: true,
      enumerable: false,
    });
    Object.defineProperty(callable, 'expression', {
      value: name,
      enumerable: false,
    });

    // The proxy handles all property access, so we cast to ExampleProxy
    return callable as unknown as ExampleProxy;
  };

  const proxy = new Proxy({} as ExampleProxy, {
    get(_, prop: string | symbol): ExampleProxy {
      if (typeof prop === 'symbol') {
        return undefined as unknown as ExampleProxy;
      }

      // If this variable was previously assigned, return its recorded value
      if (assignedVars.has(prop)) {
        return createCallableValue(prop);
      }

      // Return a callable that can be used as both a method and a variable
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
