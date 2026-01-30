/**
 * Serializer registry for custom type serialization in checkpoints.
 *
 * Allows registering custom serializers/deserializers for non-JSON types
 * so they can be persisted in checkpoints.
 */

import type { SerializedValue } from '../models.js';

/**
 * A serializer function that converts a value to a JSON-serializable form.
 */
export type Serializer<T = unknown> = (value: T) => unknown;

/**
 * A deserializer function that converts back from serialized form.
 */
export type Deserializer<T = unknown> = (data: unknown) => T;

/**
 * Registry for custom type serializers.
 */
export class SerializerRegistry {
  private serializers = new Map<string, Serializer>();
  private deserializers = new Map<string, Deserializer>();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register default serializers for common types.
   */
  private registerDefaults(): void {
    // Date
    this.register(
      'Date',
      (d: Date) => d.toISOString(),
      (data: unknown) => new Date(data as string)
    );

    // Set
    this.register(
      'Set',
      (s: Set<unknown>) => [...s],
      (data: unknown) => new Set(data as unknown[])
    );

    // Map
    this.register(
      'Map',
      (m: Map<unknown, unknown>) => [...m.entries()],
      (data: unknown) => new Map(data as [unknown, unknown][])
    );

    // RegExp
    this.register(
      'RegExp',
      (r: RegExp) => ({ source: r.source, flags: r.flags }),
      (data: unknown) => {
        const d = data as { source: string; flags: string };
        return new RegExp(d.source, d.flags);
      }
    );

    // Error
    this.register(
      'Error',
      (e: Error) => ({ message: e.message, name: e.name, stack: e.stack }),
      (data: unknown) => {
        const d = data as { message: string; name: string };
        const err = new Error(d.message);
        err.name = d.name;
        return err;
      }
    );

    // Buffer/Uint8Array
    this.register(
      'Uint8Array',
      (buf: Uint8Array) => Buffer.from(buf).toString('base64'),
      (data: unknown) => new Uint8Array(Buffer.from(data as string, 'base64'))
    );
  }

  /**
   * Register a custom serializer/deserializer pair.
   */
  register<T>(
    typeName: string,
    serializer: Serializer<T>,
    deserializer: Deserializer<T>
  ): void {
    this.serializers.set(typeName, serializer as Serializer);
    this.deserializers.set(typeName, deserializer as Deserializer);
  }

  /**
   * Register a serializer using a decorator pattern.
   */
  registerSerializer<T>(typeName: string): (fn: Serializer<T>) => void {
    return (fn: Serializer<T>) => {
      this.serializers.set(typeName, fn as Serializer);
    };
  }

  /**
   * Register a deserializer using a decorator pattern.
   */
  registerDeserializer<T>(typeName: string): (fn: Deserializer<T>) => void {
    return (fn: Deserializer<T>) => {
      this.deserializers.set(typeName, fn as Deserializer);
    };
  }

  /**
   * Serialize a value to a SerializedValue.
   */
  serialize(value: unknown): SerializedValue {
    // Handle null/undefined
    if (value === null) {
      return { type: 'null', value: null, serializable: true };
    }
    if (value === undefined) {
      return { type: 'undefined', value: null, serializable: true };
    }

    // Handle primitives
    const type = typeof value;
    if (type === 'boolean' || type === 'number' || type === 'string') {
      return { type, value, serializable: true };
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return {
        type: 'array',
        value: value.map((v) => this.serialize(v)),
        serializable: true,
      };
    }

    // Handle registered types
    const constructor = value.constructor;
    if (constructor) {
      const typeName = constructor.name;
      const serializer = this.serializers.get(typeName);
      if (serializer) {
        try {
          return {
            type: typeName,
            value: serializer(value),
            serializable: true,
          };
        } catch {
          return {
            type: typeName,
            value: String(value),
            serializable: false,
          };
        }
      }
    }

    // Handle plain objects
    if (type === 'object') {
      try {
        const serializedObj: Record<string, SerializedValue> = {};
        for (const [key, val] of Object.entries(value as object)) {
          serializedObj[key] = this.serialize(val);
        }
        return {
          type: 'object',
          value: serializedObj,
          serializable: true,
        };
      } catch {
        return {
          type: 'object',
          value: String(value),
          serializable: false,
        };
      }
    }

    // Handle functions (not serializable but record type)
    if (type === 'function') {
      return {
        type: 'function',
        value: (value as Function).name || '<anonymous>',
        serializable: false,
      };
    }

    // Fallback
    return {
      type: 'unknown',
      value: String(value),
      serializable: false,
    };
  }

  /**
   * Deserialize a SerializedValue back to its original form.
   */
  deserialize(serialized: SerializedValue): unknown {
    if (!serialized.serializable) {
      return undefined;
    }

    switch (serialized.type) {
      case 'null':
        return null;
      case 'undefined':
        return undefined;
      case 'boolean':
      case 'number':
      case 'string':
        return serialized.value;
      case 'array':
        return (serialized.value as SerializedValue[]).map((v) =>
          this.deserialize(v)
        );
      case 'object': {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(
          serialized.value as Record<string, SerializedValue>
        )) {
          result[key] = this.deserialize(val);
        }
        return result;
      }
      default: {
        // Try registered deserializer
        const deserializer = this.deserializers.get(serialized.type);
        if (deserializer) {
          return deserializer(serialized.value);
        }
        return undefined;
      }
    }
  }

  /**
   * Serialize a namespace (record of values).
   */
  serializeNamespace(
    namespace: Record<string, unknown>,
    exclude: Set<string> = new Set()
  ): Record<string, SerializedValue> {
    const result: Record<string, SerializedValue> = {};
    for (const [key, value] of Object.entries(namespace)) {
      if (!exclude.has(key)) {
        result[key] = this.serialize(value);
      }
    }
    return result;
  }

  /**
   * Deserialize a namespace back to a record.
   */
  deserializeNamespace(
    serialized: Record<string, SerializedValue>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(serialized)) {
      const deserialized = this.deserialize(value);
      if (deserialized !== undefined) {
        result[key] = deserialized;
      }
    }
    return result;
  }
}

/**
 * Default serializer registry instance.
 */
export const defaultRegistry = new SerializerRegistry();
