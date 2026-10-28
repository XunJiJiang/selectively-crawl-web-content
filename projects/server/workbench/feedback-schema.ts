import { z } from 'zod';
export const progressSchema = z.union([z.number().min(0).max(100), z.null(), z.literal(false)]);
