import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import type { NextFunction } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;
const CONFIG_PATH = path.join(__dirname, 'config', 'config.json');

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

function getSavePath(): string | null {
  try {
    const configRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(configRaw);
    if (config['save-in'] && typeof config['save-in'] === 'string' && config['save-in'].trim()) {
      return config['save-in'];
    }
    return null;
  } catch (e) {
    return null;
  }
}

app.post('/save', (req: any, res: any) => {
  const data = req.body;
  if (!Array.isArray(data)) {
    return res.status(400).json({ success: false, message: 'Body must be an array.' });
  }
  const savePath = getSavePath();
  if (!savePath) {
    return res.status(500).json({ success: false, message: 'save-in path not set in config.' });
  }
  try {
    let arr: any[][] = [];
    if (fs.existsSync(savePath)) {
      const fileRaw = fs.readFileSync(savePath, 'utf-8');
      arr = JSON.parse(fileRaw);
      if (!Array.isArray(arr)) arr = [];
    }
    arr.push(data); // 直接push为一个整体
    fs.writeFileSync(savePath, JSON.stringify(arr, null, 2), 'utf-8');
    res.json({ success: true, message: 'Data saved.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to save data.', error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
