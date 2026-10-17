import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { coreBootId } from './storage.ts';

export interface WorkbenchEvent {
  version: 1;
  eventId: string;
  coreBootId: string;
  stream: string;
  seq: number;
  type: string;
  entityId?: string;
  revision?: number;
  payload: unknown;
}
export class WorkbenchEvents extends EventEmitter {
  private sequence = new Map<string, number>();
  private retained: WorkbenchEvent[] = [];
  private bytes = 0;
  publish(
    type: string,
    payload: unknown,
    entityId?: string,
    revision?: number,
    stream = 'workbench',
  ) {
    const event: WorkbenchEvent = {
      version: 1,
      eventId: randomUUID(),
      coreBootId,
      stream,
      seq: (this.sequence.get(stream) ?? 0) + 1,
      type,
      entityId,
      revision,
      payload,
    };
    this.sequence.set(stream, event.seq);
    this.retained.push(event);
    this.bytes += Buffer.byteLength(JSON.stringify(event));
    while (this.bytes > 2 * 1024 * 1024 || this.retained.length > 2000) {
      this.bytes -= Buffer.byteLength(JSON.stringify(this.retained.shift()));
    }
    this.emit('event', event);
    return event;
  }
  replay(positions: Record<string, number>, bootId: string) {
    if (bootId !== coreBootId) {
      return { gap: true, events: [] };
    }
    for (const stream of new Set([...this.sequence.keys(), ...Object.keys(positions)])) {
      const seq = positions[stream] ?? 0;
      const first =
        this.retained.find((e) => e.stream === stream)?.seq ?? (this.sequence.get(stream) ?? 0) + 1;
      if (!Number.isSafeInteger(seq) || seq < first - 1 || seq > (this.sequence.get(stream) ?? 0)) {
        return { gap: true, events: [] };
      }
    }
    return { gap: false, events: this.retained.filter((e) => e.seq > (positions[e.stream] ?? 0)) };
  }
}
export const workbenchEvents = new WorkbenchEvents();
