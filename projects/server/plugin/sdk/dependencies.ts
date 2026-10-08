// This explicit list is the shared dependency contract, not all root dependencies.
export { default as axios, AxiosError, AxiosHeaders } from 'axios';
export { default as chalk } from 'chalk';
export { z } from 'zod';
export { default as Database } from 'better-sqlite3';
// Keep native ESM default interop and the package's resource-relative URLs.
export const trash: typeof import('trash').default = async (...args) =>
  (await import('trash')).default(...args);
export * as fileType from 'file-type';
export { fileTypeFromFile, fileTypeFromBuffer, fileTypeFromStream } from 'file-type';
