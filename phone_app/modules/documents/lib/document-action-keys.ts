interface PendingDocumentActionKey {
  readonly fingerprint: string;
  readonly key: string;
}

/** Keeps retries of one logical document mutation on the same idempotency key. */
export class StableDocumentActionKeys {
  readonly #pending = new Map<string, PendingDocumentActionKey>();
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
