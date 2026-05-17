import type { PluginConfig, PluginItem } from "./plugin";

export type ScriptConfig = Omit<PluginConfig, 'controls'> & {
  'script-config-symbol': typeof CONFIG_SYMBOL; // 用于标识这是一个脚本配置项
  controls: ScriptConfigItem[];
}

export type ScriptConfigItem = PluginItem & {
  'script-config-symbol': typeof CONFIG_SYMBOL; // 用于标识这是一个脚本配置项
  trigger: (value: string | number | boolean | null) => void;
}

export type TConfig = {
  api: {
    host: string;
    port: string;
    token: string;
  };
  plugin: {
    // 刷新插件配置的url更新规则, 规定当页面url的那些位置发生变化时需要刷新插件配置
    // 检测位置. //开头表示pathname, ?开头表示search 多个之间&相接, #表示hash
    // 共三个部分 '//*' '?*' '#*'
    // \i 表示忽略, \c 表示变化, \a 表示出现, \d 表示消失
    //    对于 pathname,
    //        1. 参数默认为 \i
    //        2. 继承规则: 当以 / 结尾时, 之后层级的变化将被忽略, 当不以 / 结尾时, 之后层级规则将继承最后一级的规则, 相当于修改了 (1) 中的默认规则
    //        //\i  与完全删除pathname部分时的效果相同, 相当于 //\i/\i/\i/... (基于继承规则), 后面的全部pathname将继承 \i, 表示完全忽略 pathname
    //        //\i/ 与 //\i 效果相同, 但是此处后面的层级是使用默认值 \i, 而不是继承上一级的规则
    //        //\c  可简写为 //, 相当于 //\c/\c/\c/... (基于继承规则), 表示检测整个pathname的变化
    //        //\c/ 相当于 //\c/\i/\i/... (基于默认规则), 表示只检测一级路径的变化, 二级及以上路径的变化被忽略
    //        //\a  相当于 //\a/\a/\a/... (基于继承规则), 表示一级路径及以上路径出现时触发刷新
    //        //\a/ 相当于 //\a/\i/\i/... (基于默认值), 表示一级路径出现时触发刷新
    //        //\d  相当于 //\d/\d/\d/... (基于继承规则), 表示一级路径及以上路径消失时触发刷新
    //        //\d/ 相当于 //\d/\i/\i/... (基于默认值), 表示一级路径消失时触发刷新
    //    对于 search
    //        无序的参数列表,
    //        1. 没有写出的参数默认为 \i
    //        2. 没有指定规则但写出的参数默认为 \c
    //        3. 没有指定参数的规则则会作用到其他全部未写出的参数中, 相当于修改了 (1) 中的默认规则
    //        4. 规则作用域优先级: i. 指定参数名和规则 > ii. 没有指定规则的参数名(使用规则\c) > iii. 没有指定参数名的规则(作用于其他全部未写出参数) > iv. 默认规则
    //        5. 当出现冲突时, 以第一个规则为准, 后续规则中与之冲突的部分将被忽略
    //        ?\i   与完全删除search部分的效果相同, 表示完全忽略 search
    //        ?\c   可简写为 ?, 表示检测整个search的变化
    //        ?\a   表示任何一个参数被添加时触发刷新
    //        ?\d   表示任何一个参数被删除时触发刷新
    //        ?\cparam 相当于 ?\cparam&\i, 表示param参数的变化被检测, 其他参数的变化被忽略. param 匹配 (i), 其余参数匹配 (iv)
    //        ?\iparam&\c,                表示param参数的变化被忽略, 其他参数的变化被检测. param 匹配 (i), 其余参数匹配 (iii)
    //        ?\aparam&param2,            表示param2参数的变化被检测, 其他参数的变化被忽略. param匹配 (i), param2匹配 (ii), 其他参数匹配 (iv)
    //    对于 hash, 与 pathname 的规则相同, 将 // 替换为 # 即可
    refreshRule: string;
  }
};