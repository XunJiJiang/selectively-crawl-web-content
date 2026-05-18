/** 可以被 JSON 序列化的类型 */
type JSONPrimitive = string | number | boolean | null;
export interface JSONObject { [key: string]: JSONValue; }
export type JSONValue = JSONPrimitive | JSONObject | Array<JSONValue>;

/** 可以被 JSON 序列化的类型, 但是将数组替换为函数 */
export interface JSONObjectWithFunction { [key: string]: JSONValueWithFunction; }
export type JSONValueWithFunction = JSONPrimitive | JSONObjectWithFunction | ArrayProcessor;

/** 处理数组的函数 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArrayProcessor<T = any> = (item?: JSONValue) => item extends JSONValue ? JSONValueWithFunction : T[];

/** 将 JSONValue 转换为 JSONValueWithFunction */
export type JSONValueToFunction<T extends JSONValue> = T extends JSONPrimitive
  ? T
  : T extends Array<infer U>
  ? ArrayProcessor<U>
  : T extends JSONObject
  ? { [K in keyof T]: JSONValueToFunction<T[K]> }
  : never;

/** 将 JSONValueWithFunction 转换为 JSONValue */
export type ResolvedJSONValue<T extends JSONValueWithFunction> = T extends JSONPrimitive
  ? T
  : T extends ArrayProcessor<infer U>
  ? U[]
  : T extends JSONObjectWithFunction
  ? { [K in keyof T]: ResolvedJSONValue<T[K]> }
  : never;

/** 合并 JSONValue 和 JSONValueWithFunction(先替换为数组) */
// export type MergedJSONValue<T extends JSONValue, U extends JSONValueWithFunction, KEEPEXTRA extends boolean> =
//   T extends JSONPrimitive
//   ? ResolvedJSONValue<U>
//   : T extends Array<infer TItem>
//   ? U extends ArrayProcessor<infer UItem>
//     ? Array<MergedJSONValue<TItem, UItem, KEEPEXTRA>>
//     : U
//   : T extends JSONObject
//     ? U extends JSONObjectWithFunction
//       ? { [K in keyof T | keyof U]: K extends keyof U
//         ? K extends keyof T
//           ? MergedJSONValue<T[K], U[K], KEEPEXTRA>
//           : U[K]
//         : K extends keyof T
//         ? MergedJSONValue<T[K], never, KEEPEXTRA>
//         : never }
//       : U
//     : never;