export interface ResponseData<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}
