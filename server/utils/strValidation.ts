export function strValidation(str: string): string {
  if (typeof str !== 'string') return str;
  // 替换掉所有不安全的字符
  return str.replace(/[\\/:*?"<>|]/g, '-');
}
