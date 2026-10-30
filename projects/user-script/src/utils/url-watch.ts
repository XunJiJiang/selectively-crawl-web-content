/** History API 在油猴隔离环境可能不可拦截，用 href 检查补齐该路径；退出时释放全部监听。 */
export function watchUrl(
  callback: (before: string, after: string) => void,
  target: Window = window,
) {
  let previous = target.location.href;
  const check = () => {
    const current = target.location.href;
    if (current !== previous) {
      const before = previous;
      previous = current;
      callback(before, current);
    }
  };
  const history = target.history;
  const original = { pushState: history.pushState, replaceState: history.replaceState };
  const wrappers = {
    pushState: function (this: History, ...args: Parameters<History['pushState']>) {
      original.pushState.apply(this, args);
      check();
    },
    replaceState: function (this: History, ...args: Parameters<History['replaceState']>) {
      original.replaceState.apply(this, args);
      check();
    },
  };
  history.pushState = wrappers.pushState;
  history.replaceState = wrappers.replaceState;
  target.addEventListener('popstate', check);
  target.addEventListener('hashchange', check);
  const interval = target.setInterval(check, 500);
  return () => {
    target.clearInterval(interval);
    target.removeEventListener('popstate', check);
    target.removeEventListener('hashchange', check);
    for (const key of ['pushState', 'replaceState'] as const) {
      if (history[key] === wrappers[key]) {
        history[key] = original[key];
      }
    }
  };
}
