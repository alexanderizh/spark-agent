export interface KeypressLike {
  readonly name?: string;
  readonly code?: string | number;
  readonly isComposing?: boolean;
}

export function shouldSwallowImeKeypress(key: KeypressLike): boolean {
  if (key.isComposing) return true;
  if (key.name !== 'return') return false;
  return key.code === 229 || key.code === '229' || key.code === 'Process';
}

export function isCompositionSensitiveKey(key: KeypressLike): boolean {
  return Boolean(
    key.isComposing &&
      (key.name === 'return' ||
        key.name === 'up' ||
        key.name === 'down' ||
        (key.name !== undefined && /^[0-9]$/.test(key.name))),
  );
}
