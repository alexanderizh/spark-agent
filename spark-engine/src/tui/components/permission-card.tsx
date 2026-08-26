import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import type { PermissionDecision } from '../../permission/types.js';
import type { PendingApproval } from '../../permission/interactive.js';
import type { TuiTheme } from '../theme.js';

export interface PermissionCardProps {
  readonly pending: PendingApproval;
  readonly theme: TuiTheme;
  readonly onDecide: (decision: PermissionDecision) => void;
  readonly onNotice: (message: string) => void;
}

export function PermissionCard({ pending, theme, onDecide, onNotice }: PermissionCardProps): ReactElement {
  const [selected, setSelected] = useState(0);
  const options = useMemo(
    () => [
      { label: '允许一次', decision: { decision: 'allow', grantScope: 'once' } as const },
      ...(pending.request.allowedGrantScopes.includes('session')
        ? [
            {
              label: '本会话不再询问',
              decision: { decision: 'allow', grantScope: 'session' } as const,
            },
          ]
        : []),
      {
        label: '拒绝',
        decision: { decision: 'deny', reason: 'User rejected the tool call' } as const,
      },
    ],
    [pending.request.allowedGrantScopes],
  );
  useEffect(() => {
    setSelected(0);
  }, [pending.request.requestId]);
  useInput((input, key) => {
    if (key.escape) {
      onDecide({ decision: 'deny', reason: 'User rejected with Escape' });
      return;
    }
    if (key.upArrow) setSelected((value) => (value + options.length - 1) % options.length);
    else if (key.downArrow) setSelected((value) => (value + 1) % options.length);
    else if (/^[1-9]$/.test(input) && Number(input) <= options.length) choose(Number(input) - 1);
    else if (key.return) choose(selected);
  });

  const choose = (index: number): void => {
    setSelected(index);
    const option = options[index];
    if (!option) {
      onNotice('无效权限选项');
      return;
    }
    onDecide(option.decision);
  };

  const { request } = pending;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent}>权限确认 · {request.call.name}</Text>
      <Text>{request.argsPreview}</Text>
      {request.reason && <Text color={theme.dim}>策略: {request.reason}</Text>}
      {request.sessionScopeLabel && (
        <Text color={theme.dim}>会话授权范围: {request.sessionScopeLabel}</Text>
      )}
      <Text color={theme.warn}>风险: {request.call.definition.destructive ? '破坏性工具' : '需要授权'}</Text>
      <Text>
        {options
          .map((option, index) => `${selected === index ? '❯' : ' '} ${index + 1} ${option.label}`)
          .join('   ')}
      </Text>
      <Text color={theme.dim}>↑↓/数字选择 · enter 确认 · esc 拒绝</Text>
    </Box>
  );
}
