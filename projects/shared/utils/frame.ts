/** 一次性帧调度；返回取消函数，取消后即使宿主已排队也不会再调用回调。 */
export function scheduleFrame(callback: () => void): () => void {
  let pending = true;
  const run = () => {
    if (pending) {
      pending = false;
      callback();
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(run);
    return () => {
      pending = false;
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(handle);
      }
    };
  }
  const handle = setTimeout(run, 16);
  return () => {
    pending = false;
    clearTimeout(handle);
  };
}
