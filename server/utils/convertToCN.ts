import * as OpenCC from 'opencc-js';

const converter1 = OpenCC.Converter({ from: 'hk', to: 'cn' });
const converter2 = OpenCC.Converter({ from: 'tw', to: 'cn' });
const converter3 = OpenCC.Converter({ from: 'jp', to: 'cn' });

/** 将非cn汉字转为cn */
export function convertToCN (str: string): string {
  if (typeof str !== 'string') return str;
  let converted = converter1(str);
  converted = converter2(converted);
  converted = converter3(converted);
  return converted;
}
