/** Completion intentionally splits literal spaces, preserving the unfinished last word. */
export function completionInput(command: string, cursor = command.length) {
  const parts = command.split(' ');
  const word = parts.pop() ?? '';
  const parents = parts.filter(Boolean);
  const start = command.length - word.length;
  const isKey = word.startsWith('-');
  const equals = isKey ? word.indexOf('=') : -1;
  const isValue = equals >= 0;
  const from = isValue ? start + equals + 1 : start;
  return {
    parents,
    word,
    start,
    from,
    to: command.length,
    isKey,
    isValue,
    key: isValue ? word.slice(0, equals).replace(/^--?/, '') : undefined,
    prefix: command.slice(from, Math.max(from, cursor)),
    deep: parents.length >= 2,
    eligible: cursor >= start && cursor <= command.length,
    stem: command.slice(0, from),
  };
}
