interface PendingClientActionKey {
  readonly fingerprint: string;
  readonly key: string;
}

/**
 * Keeps one idempotency key for a logical client action until the server
 * confirms it. A changed payload receives a new key, while a network retry of
 * the same payload reuses the original key.
 */
export class StableClientActionKeys {
  readonly #pending = new Map<string, PendingClientActionKey>();
  readonly #createKey: () => string;

  constructor(createKey: () => string) {
    this.#createKey = createKey;
  }

  keyFor(action: string, fingerprint: string): string {
    const current = this.#pending.get(action);
    if (current?.fingerprint === fingerprint) return current.key;
    const key = this.#createKey();
    this.#pending.set(action, { fingerprint, key });
    return key;
  }

  complete(action: string, key: string): void {
    if (this.#pending.get(action)?.key === key) {
      this.#pending.delete(action);
    }
  }

  reset(): void {
    this.#pending.clear();
  }
}
