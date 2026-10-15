/** Join explicit continuations while retaining UTF-16 offsets for completion replacements. */
export function commandSource(text: string, ignoreTrailingContinuation = false) {
  let command = '';
  const sourceOffsets = [0];
  const sourceEndOffsets = [0];
  const commandOffsets = [0];
  for (let index = 0; index < text.length;) {
    if (
      text[index] === '\\' &&
      (text[index + 1] === '\n' || (ignoreTrailingContinuation && index + 1 === text.length))
    ) {
      commandOffsets[++index] = command.length;
      if (text[index] === '\n') {
        commandOffsets[++index] = command.length;
      }
      sourceOffsets[command.length] = index;
    } else {
      command += text[index++];
      commandOffsets[index] = command.length;
      sourceOffsets.push(index);
      sourceEndOffsets.push(index);
    }
  }
  return { command, sourceOffsets, sourceEndOffsets, commandOffsets };
}

/** Anchor empty completion ranges to the current line and preserve trailing continuations. */
export function completionSource(text: string, cursor: number, ignoreTrailingContinuation = true) {
  const source = commandSource(text, ignoreTrailingContinuation);
  const sourceCursor =
    ignoreTrailingContinuation &&
    text[cursor - 1] === '\\' &&
    (cursor === text.length || text[cursor] === '\n')
      ? cursor - 1
      : cursor;
  return {
    command: source.command.replace(/\n/g, ' '),
    commandOffsets: source.commandOffsets,
    cursor: source.commandOffsets[sourceCursor],
    sourceCursor,
    range(from: number, to: number) {
      if (from === to) {
        const offset = Math.max(
          source.sourceEndOffsets[from],
          Math.min(sourceCursor, source.sourceOffsets[from]),
        );
        return { from: offset, to: offset };
      }
      return { from: source.sourceOffsets[from], to: source.sourceEndOffsets[to] };
    },
  };
}
