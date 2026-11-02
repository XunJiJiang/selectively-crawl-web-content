import { z } from 'zod';

// 在迁移及布局创建 schema 前关闭动态代码探测，避免严格 script-src 下的 CSP 报错。
z.config({ jitless: true });
