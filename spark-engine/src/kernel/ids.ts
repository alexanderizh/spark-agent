import { randomUUID } from 'node:crypto';

import type { IdGen } from '../seams.js';

export class UuidIdGen implements IdGen {
  next(prefix = 'id'): string {
    return `${prefix}_${randomUUID()}`;
  }
}

export class SequentialIdGen implements IdGen {
  readonly #counters = new Map<string, number>();

  next(prefix = 'id'): string {
    const count = (this.#counters.get(prefix) ?? 0) + 1;
    this.#counters.set(prefix, count);
    return `${prefix}${count}`;
  }
}
