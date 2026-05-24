import { hc } from 'hono/client';

import type { AppType } from './server.ts';

export const blogClient = hc<AppType>('http://localhost');
