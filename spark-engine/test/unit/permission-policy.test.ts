import { describe, expect, it } from 'vitest';

import {
  RulePermissionPolicy,
  type PermissionRuleLayer,
} from '../../src/permission/policy.js';
import type { PermissionCheckContext, PermissionMode } from '../../src/permission/types.js';
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

    await expect(policy.check(call('bash', { command: 'npm test' }), context())).resolves.toMatchObject({
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

  it('enforces plan and bypass modes before configurable rules', async () => {
    const policy = new RulePermissionPolicy({
      layers: [
        {
          source: 'project',
          rules: [{ id: 'allow-write', tool: 'write', action: 'allow' }],
        },
      ],
    });

    await expect(policy.check(call('write', { path: 'a.ts', content: 'x' }), context('plan')))
      .resolves.toMatchObject({ decision: 'deny', reason: expect.stringContaining('Plan mode') });
    await expect(policy.check(call('bash', { command: 'rm -rf build' }), context('bypass')))
      .resolves.toMatchObject({ decision: 'allow', reason: 'Permission bypass mode' });
  });

  it('limits acceptEdits to explicit workspace-write tools', async () => {
    const policy = new RulePermissionPolicy();
    const external: ResolvedToolCall = {
      ...call('bash', { command: 'publish' }),
      name: 'publish',
      definition: {
        ...call('bash', { command: 'publish' }).definition,
        name: 'publish',
        destructive: false,
        permissionClass: 'external',
        approval: 'once',
      },
    };

    await expect(
      policy.check(call('write', { path: 'a.ts', content: 'x' }), context('acceptEdits')),
    ).resolves.toMatchObject({ decision: 'allow', reason: 'acceptEdits mode' });
    await expect(policy.check(external, context('acceptEdits'))).resolves.toMatchObject({
      decision: 'ask',
      allowedGrantScopes: ['once'],
    });
  });

  it('scopes remembered grants to one session and one resource', async () => {
    const policy = new RulePermissionPolicy();
    const first = call('write', { path: 'src/a.ts', content: 'one' });
    const sameResource = call('write', { path: 'src/a.ts', content: 'two' });
    const otherResource = call('write', { path: 'src/b.ts', content: 'two' });
    const sessionOne = context('default', 'session-1');

    await expect(policy.check(first, sessionOne)).resolves.toMatchObject({
      decision: 'ask',
      allowedGrantScopes: ['once', 'session'],
      sessionScopeLabel: 'write: src/a.ts',
    });
    policy.recordDecision(first, { decision: 'allow', grantScope: 'session' }, sessionOne);

    await expect(policy.check(sameResource, sessionOne)).resolves.toMatchObject({ decision: 'allow' });
    await expect(policy.check(otherResource, sessionOne)).resolves.toMatchObject({ decision: 'ask' });
    await expect(policy.check(sameResource, context('default', 'session-2'))).resolves.toMatchObject({
      decision: 'ask',
    });
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

function call(name: string, args: unknown): ResolvedToolCall {
  const definition = workspaceToolDefinitions.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing tool definition: ${name}`);
  return { callId: `call-${name}`, name, args, definition };
}

function context(
  mode: PermissionMode = 'default',
  sessionId = 'session-1',
): PermissionCheckContext {
  return { sessionId, mode, cwd: '/workspace' };
}
