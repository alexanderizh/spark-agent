import type { AssistantMessage, Usage } from '../../events/schema.js';

export interface FakeReply {
  readonly kind: 'reply';
  readonly message: AssistantMessage;
  readonly usage: Usage;
  readonly chunkSize: number;
}

export interface FakeFailure {
  readonly kind: 'failure';
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type FakeScriptItem = FakeReply | FakeFailure;

const DEFAULT_USAGE: Usage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export interface FakeReplyOptions {
  readonly thinking?: string;
  readonly usage?: Partial<Usage>;
  readonly chunkSize?: number;
}

function usage(overrides?: Partial<Usage>): Usage {
  return { ...DEFAULT_USAGE, ...overrides };
}

export function reply(
  message: Omit<AssistantMessage, 'toolCalls'> & {
    readonly toolCalls?: AssistantMessage['toolCalls'];
  },
  options: FakeReplyOptions = {},
): FakeReply {
  return {
    kind: 'reply',
    message: {
      ...(message.text === undefined ? {} : { text: message.text }),
      ...(message.thinking === undefined && options.thinking === undefined
        ? {}
        : { thinking: message.thinking ?? options.thinking }),
      toolCalls: [...(message.toolCalls ?? [])],
    },
    usage: usage(options.usage),
    chunkSize: options.chunkSize ?? 12,
  };
}

export function text(content: string, options: FakeReplyOptions = {}): FakeReply {
  return reply({ text: content }, options);
}

export function toolCall(
  callId: string,
  name: string,
  args: unknown,
  options: FakeReplyOptions & { readonly text?: string } = {},
): FakeReply {
  return reply(
    {
      ...(options.text === undefined ? {} : { text: options.text }),
      toolCalls: [{ callId, name, args }],
    },
    options,
  );
}

export function toolCalls(
  calls: AssistantMessage['toolCalls'],
  options: FakeReplyOptions & { readonly text?: string } = {},
): FakeReply {
  return reply(
    {
      ...(options.text === undefined ? {} : { text: options.text }),
      toolCalls: [...calls],
    },
    options,
  );
}

export function fail(
  code: string,
  options: { readonly message?: string; readonly retryable?: boolean } = {},
): FakeFailure {
  return {
    kind: 'failure',
    code,
    message: options.message ?? code,
    retryable: options.retryable ?? false,
  };
}

export function empty(options: FakeReplyOptions = {}): FakeReply {
  return reply({}, options);
}
