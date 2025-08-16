import fs from 'fs';
import path from 'path';
import log from './log';
import { fetchImage } from './fetchImage';
import { v4 as uuidv4 } from 'uuid';

/**
 * 处理 dataURL
 * 将其转换为图片文件并保存到指定目录
 * @param dataUrl base64编码的dataURL字符串
 * @param filePath 保存路径或函数
 * 如果是函数, 接收一个对象参数, 包含以下字段:
 * - fullname: 完整文件名, 包含扩展名
 * - filename: 不包含扩展名的文件名
 * - ext: 文件扩展名
 * - datePrefix: 日期前缀, 格式为 YYYYMMDDHHmmss
 * - 返回值为最终保存的文件路径
 * @returns 如果成功, 返回保存的文件路径; 如果失败, 返回 false
 */
export async function writeDataURL(
  dataUrl: string,
  filePath: string | ((props: { fullname: string; filename: string; ext: string; datePrefix: string }) => string)
): Promise<false | string> {
  const _writeImg = (buf: Buffer, ext: string) => {
    const _filePath = (() => {
      const datePrefix = new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14); // e.g. 20250620153045
      const filename = `${datePrefix}_${uuidv4()}`;
      const fullname = `${filename}.${ext}`;
      if (typeof filePath === 'function') {
        return filePath({
          fullname,
          filename,
          ext,
          datePrefix,
        });
      } else {
        return path.join(filePath, fullname);
      }
    })();

    fs.writeFileSync(_filePath, buf);

    return _filePath;
  };

  // dataUrl 为网址时
  if (/^https?:\/\//.test(dataUrl)) {
    try {
      const imgBuffer = await fetchImage(dataUrl);
      if (imgBuffer) {
        const _filePath = _writeImg(imgBuffer, 'png');
        if (_filePath) return _filePath;
      } else {
        throw new Error('获取图片失败');
      }
    } catch {
      log.warn('无效的图片 url:', dataUrl);
      return false;
    }
  }

  // dataUrl 为 base64 编码时
  try {
    // 解析dataURL
    const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
    if (!match) return false;
    const ext = match[1] ?? 'png';
    const base64 = match[2];
    const buf = Buffer.from(base64, 'base64');
    const _filePath = _writeImg(buf, ext);
    return _filePath;
  } catch (e) {
    log.warn('写入图片失败:', e);
    return false;
  }
}

/**
 * 保存数据
 * @param dirPath 保存位置
 * @param data
 * @returns
 */
export async function writeData<D>(
  dirPath: string,
  data: D
): Promise<
  | false
  | {
      data: D;
    }
> {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    // 确保images目录存在
    const imagesDir = path.join(dirPath, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const dataJsonPath = path.join(dirPath, 'data.json');
    let raw: unknown[];

    // 检查 data.json 是否存在且根元素为数组或为空
    if (fs.existsSync(dataJsonPath)) {
      const _raw = fs.readFileSync(dataJsonPath, 'utf-8');
      try {
        raw = JSON.parse(_raw);
        if (!Array.isArray(raw) && _raw.trim() !== '') {
          return false;
        }
        if (!Array.isArray(raw)) {
          raw = [];
        }
      } catch {
        return false;
      }
    } else {
      fs.writeFileSync(dataJsonPath, '', 'utf-8');
      raw = [];
    }

    // 判断 data 若是数组, 是否存在 DataItem
    if (
      Array.isArray(data) &&
      data.length &&
      data.some(item => typeof item === 'object' && item !== null && 'images' in item)
    ) {
      // 处理所有图片
      const newData: unknown[] = [];

      for (const item of data) {
        if (typeof item !== 'object' || item === null || !('images' in item) || !Array.isArray(item.images))
          return item;
        const newImages: string[] = [];
        for (const imgDataUrl of item.images) {
          const filePath = await writeDataURL(imgDataUrl, imagesDir);
          if (!filePath) continue;
          newImages.push(filePath);
        }
        newData.push({ ...item, images: newImages });
      }

      raw.push(newData);
    } else {
      // 非DataItem[]，直接写入data.json
      raw.push(data);
    }
    fs.writeFileSync(dataJsonPath, JSON.stringify(raw, null, 2), 'utf-8');

    return {
      data: raw[raw.length - 1] as D, // 返回最新写入的数据
    };
  } catch (e) {
    log.warn('写入json文件失败:', e);
    return false;
  }
}
