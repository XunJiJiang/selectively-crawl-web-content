import { createContext } from 'react';
import { loadFromStorage } from '../hooks/useFloatingWindow';

export const SELECTIVE_CRAWL_KEY = '__selective_crawl_items__';
export const CONFIG_KEY = '__selective_crawl_config__';

const config = loadFromStorage(CONFIG_KEY, {
  api: {
    host: import.meta.env.HOST ?? 'http://localhost',
    port: import.meta.env.PORT ?? '3200',
  },
});

const configContext = createContext(config);

export default configContext;
