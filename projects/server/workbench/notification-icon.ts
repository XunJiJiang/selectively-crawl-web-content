import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { ROOT, SERVER_ROOT, isPackaged } from '../common/paths.ts';

/** Extract the largest favicon frame, preserving its pixels in a native-compatible PNG. */
function iconPNG(icon: Buffer): Buffer {
  if (icon.readUInt16LE(2) !== 1) throw new Error('通知图标不是 ICO 文件');
  const frames = Array.from({ length: icon.readUInt16LE(4) }, (_, index) => {
    const offset = 6 + index * 16;
    return {
      size: icon[offset] || 256,
      bytes: icon.readUInt32LE(offset + 8),
      offset: icon.readUInt32LE(offset + 12),
    };
  }).sort((a, b) => b.size - a.size);
  const frame = frames[0];
  if (!frame) throw new Error('通知图标没有图像');
  const data = icon.subarray(frame.offset, frame.offset + frame.bytes);
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return data;
  const header = data.readUInt32LE(0),
    width = data.readInt32LE(4),
    height = Math.abs(data.readInt32LE(8)) / 2;
  if (
    data.readUInt16LE(14) !== 32 ||
    width < 1 ||
    height < 1 ||
    width > 256 ||
    height > 256 ||
    data.readUInt32LE(16) !== 0
  ) {
    throw new Error('通知 favicon 需要 PNG 或未压缩的 32 位 ICO 图像');
  }
  const pixels = Buffer.alloc(height * (1 + width * 4));
  const maskStride = Math.ceil(width / 32) * 4;
  const maskOffset = header + width * height * 4;
  const hasAlpha = Array.from({ length: width * height }, (_, i) => data[header + i * 4 + 3]).some(
    Boolean,
  );
  for (let y = 0; y < height; y++) {
    const sourceY = data.readInt32LE(8) > 0 ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const source = header + (sourceY * width + x) * 4,
        target = y * (1 + width * 4) + 1 + x * 4;
      pixels[target] = data[source + 2];
      pixels[target + 1] = data[source + 1];
      pixels[target + 2] = data[source];
      const transparent =
        (data[maskOffset + sourceY * maskStride + (x >> 3)] ?? 0) & (128 >> (x & 7));
      pixels[target + 3] = transparent ? 0 : hasAlpha ? data[source + 3] : 255;
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const value = Buffer.concat([Buffer.from(type), body]);
    let crc = 0xffffffff;
    for (const byte of value) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const output = Buffer.alloc(body.length + 12);
    output.writeUInt32BE(body.length);
    value.copy(output, 4);
    output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
    return output;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
let prepared: Promise<string> | undefined;
export function notificationIconFile() {
  return (prepared ??= (async () => {
    const source = isPackaged
      ? path.join(SERVER_ROOT, 'public/resources/notification.ico')
      : path.join(ROOT, 'projects/web/public/favicon.ico');
    const directory = await mkdtemp(path.join(tmpdir(), 'scwc-notification-icon-'));
    const output = path.join(directory, 'favicon.png');
    await writeFile(output, iconPNG(await readFile(source)), { mode: 0o600 });
    return output;
  })().catch((error) => {
    prepared = undefined;
    throw error;
  }));
}
