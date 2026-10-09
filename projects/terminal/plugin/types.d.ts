import type { ChildProcess } from 'node:child_process';
import type { Peer } from '../peer.ts';
import type { CommandInfo } from '../protocol.ts';

export interface Loaded {
  id: string;
  directory: string;
  identifier: string;
  signature: string;
  owner: string;
  peer: Peer;
  child: ChildProcess;
  closed: Promise<unknown>;
  commands: CommandInfo[];
  prefixed: boolean;
  hadConflict: boolean;
  discarded: boolean;
  published: boolean;
}
export interface CommandConflict {
  kind: 'identifier' | 'commands' | 'cleared';
  names: string[];
  identifier?: string;
  first: { kind: 'system' | 'plugin'; id: string; label: string };
  second: { kind: 'plugin'; id: string; label: string };
  identifiers?: { first?: string; second?: string };
  checkIdentifier?(identifier: string, participant: 'first' | 'second'): string | undefined;
}
export type ConflictChoice = 'a' | 'b' | 'c' | 'd' | 'e';
export interface PluginPreference {
  policy?: 'prefix' | 'plain' | 'discard';
  identifier?: string;
}
export type PluginPreferences = Record<string, PluginPreference>;
