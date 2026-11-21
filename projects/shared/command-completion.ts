export interface CommandCompletionValue {
  /** The full value after = exactly as typed, including any quotes. */
  raw: string;
  /** Completed values before the last segment, decoded, trimmed and in input order. */
  values: string[];
  /** The decoded prefix of the last segment at the cursor. */
  prefix: string;
  isNextValue: boolean;
}

/** Scans quoted words even while the last quote is open. Offsets refer to the original string. */
export function scanCommandWords(command: string) {
  const words: { text: string; start: number; end: number; closingQuote: number }[] = [];
  let start = -1;
  let closingQuote = -1;
  let quote = '';
  let text = '';
  for (let i = 0; i < command.length; i++) {
    const character = command[i];
    if (!quote && /\s/u.test(character)) {
      if (start >= 0) words.push({ text, start, end: i, closingQuote });
      start = -1;
      closingQuote = -1;
      text = '';
      continue;
    }
    if (start < 0) start = i;
    if (quote) {
      if (character === quote) {
        quote = '';
        closingQuote = i;
      } else if (character === '\\' && command[i + 1] === quote) {
        text += command[++i];
      } else {
        text += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else {
      text += character;
    }
  }
  if (start >= 0) words.push({ text, start, end: command.length, closingQuote });
  return { words, quote };
}

export function completionInput(
  command: string,
  cursor = command.length,
  multiValueOptions: readonly string[] = [],
) {
  const multiValue = multiValueOptions.length
    ? multiValueInput(command, cursor, multiValueOptions)
    : undefined;
  if (multiValue) return multiValue;

  // Preserve the literal-space callback arguments and replacement ranges for existing providers.
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
    optionValue: undefined as CommandCompletionValue | undefined,
    quote: '',
  };
}

function multiValueInput(command: string, cursor: number, options: readonly string[]) {
  const { words, quote } = scanCommandWords(command);
  const current = words.pop();
  if (!current || current.end !== command.length) return;
  const word = command.slice(current.start);
  const option = /^--?([^=\s"']+)=/u.exec(word);
  if (!option || !options.includes(option[1])) return;
  const parents = words.map(({ text }) => text);
  if (parents.length < 2 || parents.includes('--', 1)) return;

  const valueStart = current.start + option[0].length;
  const raw = command.slice(valueStart);
  const comma = raw.lastIndexOf(',');
  const segmentStart = valueStart + comma + 1;
  let from = segmentStart;
  if (command[from] === '"' || command[from] === "'") from++;
  const to = current.closingQuote === current.end - 1 ? current.closingQuote : current.end;
  from = Math.min(to, from);
  while (from < to && /[\t ]/u.test(command[from])) from++;

  const prefixEnd = Math.max(valueStart, Math.min(cursor, to));
  const [prefixWord] = scanCommandWords(command.slice(current.start, prefixEnd)).words;
  const decodedPrefix = prefixWord?.text.slice(option[0].length) ?? '';
  const prefix = decodedPrefix.slice(decodedPrefix.lastIndexOf(',') + 1).trimStart();
  const values = current.text
    .slice(option[0].length)
    .split(',')
    .slice(0, -1)
    .map((value) => value.trim());
  return {
    parents,
    word,
    start: current.start,
    from,
    to,
    isKey: true,
    isValue: true,
    key: option[1],
    prefix,
    deep: true,
    eligible: cursor >= segmentStart && cursor <= current.end,
    stem: command.slice(0, from),
    optionValue: { raw, values, prefix, isNextValue: comma >= 0 } satisfies CommandCompletionValue,
    quote,
  };
}
