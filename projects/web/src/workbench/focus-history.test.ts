import { describe, expect, it } from 'vitest';
import { FocusHistory } from './focus-history.ts';

describe('workbench focus navigation', () => {
  it('removes closed targets and traverses sidebar and individual terminal locations', () => {
    const history = new FocusHistory();
    history.record({ kind: 'tab', id: 'closed' });
    history.record({ kind: 'sidebar', view: 'pages' });
    history.record({ kind: 'panel', view: 'terminal', terminalId: 'a' });
    history.record({ kind: 'panel', view: 'terminal', terminalId: 'archived' });
    history.record({ kind: 'panel', view: 'output' });
    const exists = (target: Parameters<FocusHistory['record']>[0]) =>
      target.kind === 'sidebar' || (target.kind === 'panel' && target.terminalId !== 'archived');
    expect(history.go(-1, exists)).toEqual({ kind: 'panel', view: 'terminal', terminalId: 'a' });
    expect(history.go(-1, exists)).toEqual({ kind: 'sidebar', view: 'pages' });
    expect(history.canGo(-1, exists)).toBe(false);
    expect(history.go(1, exists)).toEqual({ kind: 'panel', view: 'terminal', terminalId: 'a' });
    history.record({ kind: 'tab', id: 'new' });
    expect(history.canGo(1, () => true)).toBe(false);
  });
});
