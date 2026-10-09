import type { ChildProcess } from 'node:child_process';
import type { Peer } from '../peer.ts';
import type { CommandInfo } from '../protocol.ts';

export interface Loaded {
  id: string;
  owner: string;
  peer: Peer;
  child: ChildProcess;
  closed: Promise<unknown>;
  commands: CommandInfo[];
  prefixed: Set<string>;
  discarded: boolean;
  published: boolean;
}
export interface CommandConflict {
  name: string;
  first: { kind: 'terminal' | 'core' | 'plugin'; id: string };
  second: { kind: 'plugin'; id: string };
}
export type ConflictChoice = 'a' | 'b' | 'c';
