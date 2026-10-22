export type FocusLocation =
  | { kind: 'tab'; id: string }
  | { kind: 'sidebar'; view: 'search' | 'pages' | 'bookmarks' | 'history' | 'plugins' }
  | { kind: 'panel'; view: 'output' | 'terminal'; terminalId?: string };

export class FocusHistory {
  private entries: FocusLocation[] = [];
  private index = -1;
  private same(a: FocusLocation | undefined, b: FocusLocation) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  record(location: FocusLocation) {
    if (this.same(this.entries[this.index], location)) {
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(location);
    if (this.entries.length > 500) {
      this.entries.shift();
    }
    this.index = this.entries.length - 1;
  }
  private target(direction: number, exists: (location: FocusLocation) => boolean) {
    let next = this.index + direction;
    while (next >= 0 && next < this.entries.length) {
      if (exists(this.entries[next])) {
        return next;
      }
      this.entries.splice(next, 1);
      if (next < this.index) {
        this.index--;
      }
      next = this.index + direction;
    }
    return -1;
  }
  canGo(direction: number, exists: (location: FocusLocation) => boolean) {
    return this.target(direction, exists) >= 0;
  }
  go(direction: number, exists: (location: FocusLocation) => boolean) {
    const next = this.target(direction, exists);
    if (next < 0) {
      return;
    }
    this.index = next;
    return this.entries[next];
  }
}
