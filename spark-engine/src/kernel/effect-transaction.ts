export type EffectDisposer = () => Promise<void> | void;
export type EffectRegistration = () => Promise<EffectDisposer> | EffectDisposer;

export class EffectTransaction {
  readonly #disposers: EffectDisposer[] = [];
  #state: 'open' | 'committed' | 'rolled-back' = 'open';

  async register(effect: EffectRegistration): Promise<void> {
    if (this.#state !== 'open') throw new Error(`Effect transaction is ${this.#state}`);
    try {
      this.#disposers.push(await effect());
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  commit(): readonly EffectDisposer[] {
    if (this.#state !== 'open') throw new Error(`Effect transaction is ${this.#state}`);
    this.#state = 'committed';
    return [...this.#disposers];
  }

  async rollback(): Promise<void> {
    if (this.#state === 'rolled-back') return;
    if (this.#state === 'committed') throw new Error('Committed effects must be deactivated by their owner');
    this.#state = 'rolled-back';
    const errors: unknown[] = [];
    for (const dispose of [...this.#disposers].reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#disposers.length = 0;
    if (errors.length > 0) throw new AggregateError(errors, 'One or more effect disposers failed');
  }
}
