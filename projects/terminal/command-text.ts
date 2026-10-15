/** Join explicit continuations while retaining UTF-16 offsets for completion replacements. */
export function commandSource(text: string) {
  let command = '';
  const sourceOffsets = [0];
  const commandOffsets = [0];
  for (let index = 0; index < text.length;) {
    if (text[index] === '\\' && text[index + 1] === '\n') {
      commandOffsets[++index] = command.length;
      commandOffsets[++index] = command.length;
      sourceOffsets[command.length] = index;
    } else {
      command += text[index++];
      commandOffsets[index] = command.length;
      sourceOffsets.push(index);
    }
  }
  return { command, sourceOffsets, commandOffsets };
}
