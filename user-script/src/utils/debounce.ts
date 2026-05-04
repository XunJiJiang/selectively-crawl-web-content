export function debounce<ARGS extends unknown[]> (fn: (...args: ARGS) => void, delay: number): (...args: ARGS) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: ARGS) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, delay);
  };
}