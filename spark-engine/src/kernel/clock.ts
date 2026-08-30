import { performance } from 'node:perf_hooks';

import type { Clock } from '../seams.js';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  monotonicMs(): number {
    return Math.floor(performance.now());
  }
}

export class SteppingClock implements Clock {
  #wall: number;
  #monotonic: number;
  readonly #stepMs: number;

  constructor(startMs = 1_700_000_000_000, stepMs = 1) {
    this.#wall = startMs;
    this.#monotonic = 0;
    this.#stepMs = stepMs;
  }

  now(): number {
    const value = this.#wall;
    this.#wall += this.#stepMs;
    return value;
  }

  monotonicMs(): number {
    const value = this.#monotonic;
    this.#monotonic += this.#stepMs;
    return value;
  }
}
