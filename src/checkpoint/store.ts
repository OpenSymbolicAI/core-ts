/**
 * Checkpoint store implementations for persisting execution state.
 */

import { readFile, writeFile, unlink, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import type { ExecutionCheckpoint, CheckpointStatus } from '../models.js';
import { CheckpointError } from '../exceptions.js';

/**
 * Interface for checkpoint storage backends.
 */
export interface CheckpointStore {
  /**
   * Save a checkpoint.
   */
  save(checkpoint: ExecutionCheckpoint): Promise<void>;

  /**
   * Load a checkpoint by ID.
   */
  load(checkpointId: string): Promise<ExecutionCheckpoint | null>;

  /**
   * Delete a checkpoint.
   */
  delete(checkpointId: string): Promise<void>;

  /**
   * List checkpoint IDs by status.
   */
  listByStatus(status: CheckpointStatus): Promise<string[]>;
}

/**
 * In-memory checkpoint store for testing and development.
 */
export class InMemoryCheckpointStore implements CheckpointStore {
  private checkpoints = new Map<string, ExecutionCheckpoint>();

  async save(checkpoint: ExecutionCheckpoint): Promise<void> {
    // Deep clone to prevent external modifications
    this.checkpoints.set(checkpoint.checkpointId, structuredClone(checkpoint));
  }

  async load(checkpointId: string): Promise<ExecutionCheckpoint | null> {
    const cp = this.checkpoints.get(checkpointId);
    return cp ? structuredClone(cp) : null;
  }

  async delete(checkpointId: string): Promise<void> {
    this.checkpoints.delete(checkpointId);
  }

  async listByStatus(status: CheckpointStatus): Promise<string[]> {
    return [...this.checkpoints.values()]
      .filter((cp) => cp.status === status)
      .map((cp) => cp.checkpointId);
  }

  /**
   * List all checkpoint IDs.
   */
  async listAll(): Promise<string[]> {
    return [...this.checkpoints.keys()];
  }

  /**
   * Clear all checkpoints.
   */
  async clear(): Promise<void> {
    this.checkpoints.clear();
  }

  /**
   * Get the number of stored checkpoints.
   */
  get size(): number {
    return this.checkpoints.size;
  }
}

/**
 * File-based checkpoint store for persistent storage.
 *
 * Stores each checkpoint as a JSON file in a directory.
 */
export class FileCheckpointStore implements CheckpointStore {
  private directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  private getFilePath(checkpointId: string): string {
    // Sanitize the checkpoint ID to prevent path traversal
    const sanitized = checkpointId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return join(this.directory, `${sanitized}.json`);
  }

  async save(checkpoint: ExecutionCheckpoint): Promise<void> {
    try {
      // Ensure directory exists
      await mkdir(this.directory, { recursive: true });

      const filePath = this.getFilePath(checkpoint.checkpointId);
      const json = JSON.stringify(checkpoint, this.jsonReplacer, 2);
      await writeFile(filePath, json, 'utf-8');
    } catch (e) {
      throw new CheckpointError(
        `Failed to save checkpoint: ${e instanceof Error ? e.message : String(e)}`,
        checkpoint.checkpointId
      );
    }
  }

  async load(checkpointId: string): Promise<ExecutionCheckpoint | null> {
    try {
      const filePath = this.getFilePath(checkpointId);
      const json = await readFile(filePath, 'utf-8');
      return JSON.parse(json, this.jsonReviver);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new CheckpointError(
        `Failed to load checkpoint: ${e instanceof Error ? e.message : String(e)}`,
        checkpointId
      );
    }
  }

  async delete(checkpointId: string): Promise<void> {
    try {
      const filePath = this.getFilePath(checkpointId);
      await unlink(filePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new CheckpointError(
          `Failed to delete checkpoint: ${e instanceof Error ? e.message : String(e)}`,
          checkpointId
        );
      }
    }
  }

  async listByStatus(status: CheckpointStatus): Promise<string[]> {
    try {
      const files = await readdir(this.directory);
      const results: string[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const checkpointId = file.slice(0, -5);
        const checkpoint = await this.load(checkpointId);
        if (checkpoint && checkpoint.status === status) {
          results.push(checkpointId);
        }
      }

      return results;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new CheckpointError(
        `Failed to list checkpoints: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  /**
   * List all checkpoint IDs.
   */
  async listAll(): Promise<string[]> {
    try {
      const files = await readdir(this.directory);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new CheckpointError(
        `Failed to list checkpoints: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  /**
   * JSON replacer for dates.
   */
  private jsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    return value;
  }

  /**
   * JSON reviver for dates.
   */
  private jsonReviver(_key: string, value: unknown): unknown {
    if (
      value &&
      typeof value === 'object' &&
      (value as Record<string, unknown>).__type === 'Date'
    ) {
      return new Date((value as Record<string, string>).value);
    }
    return value;
  }
}

/**
 * Create a unique checkpoint ID.
 */
export function createCheckpointId(): string {
  return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
