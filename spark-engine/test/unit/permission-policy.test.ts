import { describe, expect, it } from 'vitest';

import { RulePermissionPolicy, type PermissionRuleLayer } from '../../src/permission/policy.js';
import {
  normalizeLegacyPermissionMode,
  type PermissionCheckContext,
  type PermissionMode,
} from '../../src/permission/types.js';
import type { ResolvedToolCall } from '../../src/tools/contract.js';
import { workspaceToolDefinitions } from '../../src/tools/workspace/definitions.js';

describe('structured permission policy', () => {
  it('uses ordered layers, tool wildcards, and JSON-pointer argument matchers', async () => {
    const layers: PermissionRuleLayer[] = [
      {
        source: 'user',
        rules: [
          {
            id: 'allow-npm',
            tool: 'bash',
            action: 'allow',
            match: [{ path: '/command', operator: 'prefix', value: 'npm ' }],
          },
        ],
      },
      {
        source: 'project',
        rules: [
          {
            id: 'deny-publish',
            tool: 'ba*',
            action: 'deny',
            reason: 'Publishing is not allowed',
            match: [{ path: '/command', operator: 'glob', value: '* publish*' }],
          },
        ],
      },
    ];
    const policy = new RulePermissionPolicy({ layers });

    await expect(
      policy.check(call('bash', { command: 'npm test' }), context()),
    ).resolves.toMatchObject({
      decision: 'allow',
      rule: { id: 'allow-npm', source: 'user' },
    });
    await expect(
      policy.check(call('bash', { command: 'npm publish --access public' }), context()),
    ).resolves.toMatchObject({
      decision: 'deny',
      reason: 'Publishing is not allowed',
      rule: { id: 'deny-publish', source: 'project' },
    });
  });

  it('skips the whole policy under bypass mode', async () => {
    const policy = new RulePermissionPolicy({
      layers: [
        {
          source: 'project',
          rules: [{ id: 'deny-write', tool: 'write', action: 'deny' }],
        },
      ],
    });

    await expect(
      policy.check(call('write', { path: 'a.ts', content: 'x' }), context('bypass')),
    ).resolves.toMatchObject({ decision: 'allow', reason: 'Permission bypass mode' });
    await expect(
      policy.check(call('bash', { command: 'rm -rf build' }), context('bypass')),
    ).resolves.toMatchObject({ decision: 'allow', reason: 'Permission bypass mode' });
  });

  it('auto-approves asks in auto mode but explicit deny rules still bite', async () => {
    const policy = new RulePermissionPolicy({
      layers: [
        {
          source: 'project',
          rules: [
            {
              id: 'deny-publish',
              tool: 'bash',
              action: 'deny',
              reason: 'Publishing is not allowed',
              match: [{ path: '/command', operator: 'prefix', value: 'npm publish' }],
            },
          ],
        },
      ],
    });
    const external: ResolvedToolCall = {
      ...call('bash', { command: 'publish' }),
      name: 'publish',
      definition: {
        ...call('bash', { command: 'publish' }).definition,
        name: 'publish',
        destructive: false,
        permissionClass: 'external',
        approval: 'always',
      },
    };

    // Shell commands would ask in manual mode; auto silences the ask.
    await expect(
      policy.check(call('bash', { command: 'npm test' }), context('auto')),
    ).resolves.toMatchObject({
      decision: 'allow',
      reason: 'Auto approval mode',
    });
    await expect(policy.check(external, context('auto'))).resolves.toMatchObject({
      decision: 'allow',
      reason: 'Auto approval mode',
    });
    // ...but an explicit deny rule is not an ask, and auto keeps it enforced.
    await expect(
      policy.check(call('bash', { command: 'npm publish --access public' }), context('auto')),
    ).resolves.toMatchObject({
      decision: 'deny',
      reason: 'Publishing is not allowed',
      rule: { id: 'deny-publish', source: 'project' },
    });
  });

  it('asks for side-effecting tools in manual mode while reads run free', async () => {
    const policy = new RulePermissionPolicy();

    await expect(policy.check(call('read', { path: 'a.ts' }), context())).resolves.toMatchObject({
      decision: 'allow',
    });
    await expect(
      policy.check(call('write', { path: 'a.ts', content: 'x' }), context()),
    ).resolves.toMatchObject({ decision: 'ask', allowedGrantScopes: ['once', 'session'] });
    await expect(
      policy.check(call('bash', { command: 'npm test' }), context()),
    ).resolves.toMatchObject({
      decision: 'ask',
      allowedGrantScopes: ['once'],
    });
  });

  it('honors session mode over allow rules only through the configured layers', async () => {
    const policy = new RulePermissionPolicy({
      layers: [
        {
          source: 'project',
          rules: [{ id: 'allow-write', tool: 'write', action: 'allow' }],
        },
      ],
    });

    await expect(
      policy.check(call('write', { path: 'a.ts', content: 'x' }), context('manual')),
    ).resolves.toMatchObject({ decision: 'allow', rule: { id: 'allow-write', source: 'project' } });
  });

  it('treats allowedTools as approval grants and disallowedTools as hard denies', async () => {
    const policy = new RulePermissionPolicy({
      allowedTools: ['mcp__spark_search__*'],
      disallowedTools: ['mcp__spark_search__delete_*'],
    });
    const allowed = externalCall('mcp__spark_search__query');
    const denied = externalCall('mcp__spark_search__delete_index');

    await expect(policy.check(allowed, context('manual'))).resolves.toMatchObject({
      decision: 'allow',
      reason: 'Tool is allowed by host configuration',
    });
    await expect(policy.check(denied, context('bypass'))).resolves.toMatchObject({
      decision: 'deny',
      reason: 'Tool is disallowed by host configuration',
    });
  });

  it('scopes remembered grants to one session and one resource', async () => {
    const policy = new RulePermissionPolicy();
    const first = call('write', { path: 'src/a.ts', content: 'one' });
    const sameResource = call('write', { path: 'src/a.ts', content: 'two' });
    const otherResource = call('write', { path: 'src/b.ts', content: 'two' });
    const sessionOne = context('manual', 'session-1');

    await expect(policy.check(first, sessionOne)).resolves.toMatchObject({
      decision: 'ask',
      allowedGrantScopes: ['once', 'session'],
      sessionScopeLabel: 'write: src/a.ts',
    });
    policy.recordDecision(first, { decision: 'allow', grantScope: 'session' }, sessionOne);

    await expect(policy.check(sameResource, sessionOne)).resolves.toMatchObject({
      decision: 'allow',
    });
    await expect(policy.check(otherResource, sessionOne)).resolves.toMatchObject({
      decision: 'ask',
    });
    await expect(policy.check(sameResource, context('manual', 'session-2'))).resolves.toMatchObject(
      {
        decision: 'ask',
      },
    );
  });

  it('never permits an always-approval tool to create a session grant', async () => {
    const policy = new RulePermissionPolicy();
    const bash = call('bash', { command: 'npm test' });
    const checkContext = context();

    await expect(policy.check(bash, checkContext)).resolves.toMatchObject({
      decision: 'ask',
      allowedGrantScopes: ['once'],
    });
    expect(() => {
      policy.recordDecision(bash, { decision: 'allow', grantScope: 'session' }, checkContext);
    }).toThrow(/does not permit session grants/u);
  });
});

describe('legacy permission mode normalization', () => {
  it('maps every pre-consolidation value to manual', () => {
    expect(normalizeLegacyPermissionMode('default')).toBe('manual');
    expect(normalizeLegacyPermissionMode('acceptEdits')).toBe('manual');
    expect(normalizeLegacyPermissionMode('plan')).toBe('manual');
  });

  it('passes current modes through and rejects unknown values', () => {
    expect(normalizeLegacyPermissionMode('manual')).toBe('manual');
    expect(normalizeLegacyPermissionMode('auto')).toBe('auto');
    expect(normalizeLegacyPermissionMode('bypass')).toBe('bypass');
    expect(normalizeLegacyPermissionMode('yolo')).toBeUndefined();
    expect(normalizeLegacyPermissionMode(undefined)).toBeUndefined();
  });
});

function call(name: string, args: unknown): ResolvedToolCall {
  const definition = workspaceToolDefinitions.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing tool definition: ${name}`);
  return { callId: `call-${name}`, name, args, definition };
}

function externalCall(name: string): ResolvedToolCall {
  const base = call('read', { path: 'a.ts' });
  return {
    ...base,
    name,
    definition: {
      ...base.definition,
      name,
      readonly: false,
      permissionClass: 'external',
      approval: 'always',
    },
  };
}

function context(mode: PermissionMode = 'manual', sessionId = 'session-1'): PermissionCheckContext {
  return { sessionId, mode, cwd: '/workspace' };
}
