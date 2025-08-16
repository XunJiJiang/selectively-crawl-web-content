import { createLogger } from './log';

/** 传入一个图片url, 尝试访问并获取返回的数据 Buffer */
export async function fetchImage(url: string, log?: SCWC.Log): Promise<Buffer | null> {
  log = log ? log : createLogger(`[fetchImage]`, url);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    log.error(`获取图片失败: ${error}`);
    return null;
  }
}
