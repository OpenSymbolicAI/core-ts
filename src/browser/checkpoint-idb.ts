/**
 * IndexedDB-backed checkpoint store for browser environments.
 *
 * Persists execution checkpoints across page refreshes, supporting
 * long-running goal-seeking and mutation approval workflows.
 */

import type { CheckpointStore } from '../checkpoint/store.js';
import type { ExecutionCheckpoint, CheckpointStatus } from '../models.js';

export class IndexedDBCheckpointStore implements CheckpointStore {
  private dbName: string;
  private storeName = 'checkpoints';
  private db: IDBDatabase | null = null;

  constructor(dbName = 'opensymbolicai') {
    this.dbName = dbName;
  }

  private async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'checkpointId' });
          store.createIndex('status', 'status', { unique: false });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onclose = () => { this.db = null; };
        resolve(this.db);
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });
  }

  async save(checkpoint: ExecutionCheckpoint): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(structuredClone(checkpoint));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save checkpoint'));
    });
  }

  async load(checkpointId: string): Promise<ExecutionCheckpoint | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const request = tx.objectStore(this.storeName).get(checkpointId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('Failed to load checkpoint'));
    });
  }

  async delete(checkpointId: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(checkpointId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete checkpoint'));
    });
  }

  async listByStatus(status: CheckpointStatus): Promise<string[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const index = tx.objectStore(this.storeName).index('status');
      const request = index.getAllKeys(status);
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error ?? new Error('Failed to list checkpoints'));
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
