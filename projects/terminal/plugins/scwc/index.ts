/** Quote for the core tokenizer, retaining trailing Windows path separators. */
function quoteArgument(value: string): string {
  const trailing = value.match(/\\+$/)?.[0] ?? '';
  const prefix = trailing ? value.slice(0, -trailing.length) : value;
  return `"${prefix.replaceAll('"', '\\"')}"${trailing}`;
}

export default {
  id: 'scwc',
  apiVersion: 1,
  onLoad({ coreCommands, registerCommand, completeCore }) {
    for (const command of coreCommands) {
      if (!command.system || ['exit', 'restart'].includes(command.name)) {
        continue;
      }
      registerCommand({
        name: command.name,
        description: command.description ?? command.name,
        scope: 'global',
        usage: command.usage ?? command.name,
        async complete(request) {
          const result = await completeCore(request);
          return { ...result, command: result.command ?? request.command };
        },
        execute(context) {
          const args = context.args.map(quoteArgument);
          return context.invokeCore([command.name, ...args].join(' '));
        },
      });
    }
  },
} satisfies SCWCTerminal.Plugin;
