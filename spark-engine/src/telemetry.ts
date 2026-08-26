import type { Telemetry } from './seams.js';

export class NullTelemetry implements Telemetry {
  counter(name: string, attributes?: Readonly<Record<string, string | number>>): void {
    void name;
    void attributes;
  }

  hist(
    name: string,
    value: number,
    attributes?: Readonly<Record<string, string | number>>,
  ): void {
    void name;
    void value;
    void attributes;
  }
}

export interface TelemetryRecord {
  readonly kind: 'counter' | 'hist';
  readonly name: string;
  readonly value: number;
  readonly attributes?: Readonly<Record<string, string | number>>;
}

export class MemoryTelemetry implements Telemetry {
  readonly records: TelemetryRecord[] = [];

  counter(name: string, attributes?: Readonly<Record<string, string | number>>): void {
    this.records.push({
      kind: 'counter',
      name,
      value: 1,
      ...(attributes === undefined ? {} : { attributes }),
    });
  }

  hist(
    name: string,
    value: number,
    attributes?: Readonly<Record<string, string | number>>,
  ): void {
    this.records.push({
      kind: 'hist',
      name,
      value,
      ...(attributes === undefined ? {} : { attributes }),
    });
  }
}
