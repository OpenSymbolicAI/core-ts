/**
 * Execution namespace for managing variables and functions during plan execution.
 *
 * Provides a controlled environment where:
 * - Variables can be read and written
 * - Primitives are bound to the agent instance
 * - Builtins provide safe helper functions
 */

import type { PrimitiveMetadata } from '../models.js';

/**
 * Options for creating an execution namespace.
 */
export interface NamespaceOptions {
  /**
   * The agent instance to bind primitives to.
   */
  agent: object;

  /**
   * Map of primitive names to their metadata.
   */
  primitives: Map<string, PrimitiveMetadata>;

  /**
   * Map of allowed builtin function names to their implementations.
   */
  builtins: Record<string, Function>;

  /**
   * Initial variables to populate the namespace with.
   */
  initialVariables?: Record<string, unknown>;
}

/**
 * Manages the execution namespace for plan interpretation.
 *
 * The namespace has three layers:
 * 1. Variables - user-defined values from plan execution
 * 2. Primitives - methods from the agent bound to the instance
 * 3. Builtins - safe helper functions
 */
export class ExecutionNamespace {
  private variables: Map<string, unknown> = new Map();
  private primitives: Map<string, Function> = new Map();
  private primitiveMeta: Map<string, PrimitiveMetadata> = new Map();
  private builtins: Map<string, Function> = new Map();
  private agent: object;

  constructor(options: NamespaceOptions) {
    this.agent = options.agent;

    // Bind primitives to agent
    for (const [name, metadata] of options.primitives) {
      const method = (options.agent as Record<string, unknown>)[name];
      if (typeof method === 'function') {
        this.primitives.set(name, method.bind(options.agent));
        this.primitiveMeta.set(name, metadata);
      }
    }

    // Set up builtins
    for (const [name, fn] of Object.entries(options.builtins)) {
      this.builtins.set(name, fn);
    }

    // Initialize variables
    if (options.initialVariables) {
      for (const [name, value] of Object.entries(options.initialVariables)) {
        this.variables.set(name, value);
      }
    }
  }

  /**
   * Get a value from the namespace.
   *
   * Lookup order: variables -> primitives -> builtins
   */
  get(name: string): unknown {
    // Handle this reference (agent instance)
    if (name === 'this') {
      return this.agent;
    }

    // Handle this.method access
    if (name.startsWith('this.')) {
      const methodName = name.slice(5);
      if (this.primitives.has(methodName)) {
        return this.primitives.get(methodName);
      }
      throw new Error(`Unknown primitive: ${methodName}`);
    }

    // Check variables first
    if (this.variables.has(name)) {
      return this.variables.get(name);
    }

    // Then primitives
    if (this.primitives.has(name)) {
      return this.primitives.get(name);
    }

    // Then builtins
    if (this.builtins.has(name)) {
      return this.builtins.get(name);
    }

    throw new Error(`Undefined variable: ${name}`);
  }

  /**
   * Set a variable in the namespace.
   */
  set(name: string, value: unknown): void {
    this.variables.set(name, value);
  }

  /**
   * Check if a name exists in the namespace.
   */
  has(name: string): boolean {
    return (
      name === 'this' ||
      this.variables.has(name) ||
      this.primitives.has(name) ||
      this.builtins.has(name)
    );
  }

  /**
   * Check if a name refers to a primitive.
   */
  isPrimitive(name: string): boolean {
    // Handle this.method
    if (name.startsWith('this.')) {
      return this.primitives.has(name.slice(5));
    }
    return this.primitives.has(name);
  }

  /**
   * Get the metadata for a primitive.
   */
  getPrimitiveMetadata(name: string): PrimitiveMetadata | undefined {
    // Handle this.method
    if (name.startsWith('this.')) {
      return this.primitiveMeta.get(name.slice(5));
    }
    return this.primitiveMeta.get(name);
  }

  /**
   * Check if a primitive is read-only.
   */
  isReadOnly(name: string): boolean {
    const meta = this.getPrimitiveMetadata(name);
    return meta?.readOnly ?? false;
  }

  /**
   * Delete a variable from the namespace.
   */
  delete(name: string): boolean {
    return this.variables.delete(name);
  }

  /**
   * Get a snapshot of all user-defined variables.
   */
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.variables);
  }

  /**
   * Get the names of all variables.
   */
  variableNames(): string[] {
    return [...this.variables.keys()];
  }

  /**
   * Get the names of all primitives.
   */
  primitiveNames(): string[] {
    return [...this.primitives.keys()];
  }

  /**
   * Get the names of all builtins.
   */
  builtinNames(): string[] {
    return [...this.builtins.keys()];
  }

  /**
   * Restore variables from a snapshot.
   */
  restore(snapshot: Record<string, unknown>): void {
    this.variables.clear();
    for (const [name, value] of Object.entries(snapshot)) {
      this.variables.set(name, value);
    }
  }

  /**
   * Create a serializable snapshot excluding functions and complex objects.
   */
  serializableSnapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [name, value] of this.variables) {
      try {
        // Test if the value can be serialized to JSON
        JSON.stringify(value);
        result[name] = value;
      } catch {
        // Skip non-serializable values
        result[name] = `<non-serializable: ${typeof value}>`;
      }
    }

    return result;
  }
}

/**
 * Default builtin implementations for plans.
 */
export const DEFAULT_BUILTINS: Record<string, Function> = {
  // Collection functions
  len: (arr: unknown[] | string | Map<unknown, unknown> | Set<unknown>) => {
    if (Array.isArray(arr) || typeof arr === 'string') {
      return arr.length;
    }
    if (arr instanceof Map || arr instanceof Set) {
      return arr.size;
    }
    if (typeof arr === 'object' && arr !== null) {
      return Object.keys(arr).length;
    }
    throw new Error(`len() requires a sequence or collection`);
  },

  range: (start: number, end?: number, step = 1) => {
    if (end === undefined) {
      end = start;
      start = 0;
    }
    const result: number[] = [];
    if (step > 0) {
      for (let i = start; i < end; i += step) {
        result.push(i);
      }
    } else if (step < 0) {
      for (let i = start; i > end; i += step) {
        result.push(i);
      }
    }
    return result;
  },

  enumerate: <T>(arr: T[], start = 0): Array<[number, T]> => {
    return arr.map((item, idx) => [idx + start, item]);
  },

  zip: <T, U>(a: T[], b: U[]): Array<[T, U]> => {
    const length = Math.min(a.length, b.length);
    const result: Array<[T, U]> = [];
    for (let i = 0; i < length; i++) {
      result.push([a[i], b[i]]);
    }
    return result;
  },

  // Type constructors
  int: (x: unknown) => {
    const n = parseInt(String(x), 10);
    if (isNaN(n)) throw new Error(`Cannot convert ${x} to int`);
    return n;
  },

  float: (x: unknown) => {
    const n = parseFloat(String(x));
    if (isNaN(n)) throw new Error(`Cannot convert ${x} to float`);
    return n;
  },

  str: (x: unknown) => String(x),

  bool: (x: unknown) => Boolean(x),

  list: <T>(x: Iterable<T> | ArrayLike<T>): T[] => Array.from(x),

  dict: (entries?: Iterable<[unknown, unknown]>) => {
    if (!entries) return {};
    return Object.fromEntries(entries);
  },

  set: <T>(x?: Iterable<T>) => new Set(x),

  tuple: <T>(x: Iterable<T> | ArrayLike<T>): readonly T[] =>
    Object.freeze(Array.from(x)),

  // Math functions
  abs: Math.abs,
  min: (...args: number[]) => {
    if (args.length === 1 && Array.isArray(args[0])) {
      return Math.min(...args[0]);
    }
    return Math.min(...args);
  },
  max: (...args: number[]) => {
    if (args.length === 1 && Array.isArray(args[0])) {
      return Math.max(...args[0]);
    }
    return Math.max(...args);
  },
  sum: (arr: number[], start = 0) => arr.reduce((a, b) => a + b, start),
  round: (n: number, decimals = 0) => {
    const factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  },
  pow: Math.pow,

  // Other useful functions
  sorted: <T>(arr: T[], key?: (item: T) => unknown, reverse = false): T[] => {
    const result = [...arr];
    result.sort((a, b) => {
      const aKey = key ? key(a) : a;
      const bKey = key ? key(b) : b;
      // Cast to comparable types for the comparison
      const aComp = aKey as string | number;
      const bComp = bKey as string | number;
      if (aComp < bComp) return reverse ? 1 : -1;
      if (aComp > bComp) return reverse ? -1 : 1;
      return 0;
    });
    return result;
  },

  reversed: <T>(arr: T[]): T[] => [...arr].reverse(),

  any: (arr: unknown[]) => arr.some(Boolean),

  all: (arr: unknown[]) => arr.every(Boolean),

  print: (...args: unknown[]) => {
    console.log(...args);
    return null;
  },

  repr: (x: unknown) => JSON.stringify(x),

  // String functions
  ord: (c: string) => c.charCodeAt(0),
  chr: (n: number) => String.fromCharCode(n),

};
