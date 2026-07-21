interface TStruct {
  type: '//' | '?' | '#' | '&' | '\\i' | '\\c' | '\\a' | '\\d' | '/' | 'param' | 'unknown';
  str: string;
  startIdx: number;
  endIdx: number;
}

export interface TParseResult {
  pathname: {
    base: 'i' | 'c' | 'a' | 'd' | '';
    segments: { rule: 'i' | 'c' | 'a' | 'd' }[];
  };
  search: {
    base: 'i' | 'c' | 'a' | 'd' | '';
    params: Map<string, 'i' | 'c' | 'a' | 'd'>;
  };
  hash: {
    base: 'i' | 'c' | 'a' | 'd' | '';
    segments: { rule: 'i' | 'c' | 'a' | 'd' }[];
  };
}

/** 匹配规则解析器 */
class RefreshRuleParser {
  private _rule = '';
  private _length = 0;

  // constructor() {}

  private _result: TParseResult = {
    pathname: {
      base: '',
      segments: [],
    },
    search: {
      base: '',
      params: new Map(),
    },
    hash: {
      base: '',
      segments: [],
    },
  };

  private _charIdx = 0;
  /** 当前解析区域, 用于在解析过程中记录当前正在解析 pathname、search、 hash 还是 ignore */
  private _currentArea: 'pathname' | 'search' | 'hash' | 'ignore' | 'none' = 'none';
  /** 区域解析完成标志 */
  private _areaDone = {
    pathname: false,
    search: false,
    hash: false,
  };

  private _reset() {
    this._charIdx = 0;
    this._currentArea = 'none';
    this._areaDone = {
      pathname: false,
      search: false,
      hash: false,
    };
    this._result = {
      pathname: {
        base: 'i',
        segments: [],
      },
      search: {
        base: 'i',
        params: new Map(),
      },
      hash: {
        base: 'i',
        segments: [],
      },
    };
    this._info = [];
  }

  /** 读取下一个字符 */
  private _nextChar() {
    if (this._charIdx >= this._length) {
      return {
        char: '',
        done: true,
      };
    }
    const char = this._rule[this._charIdx++];
    return {
      char,
      done: false,
    };
  }

  /** 预读取接下来某个字符 */
  private _peekChar(n = 1) {
    if (this._charIdx + n - 1 >= this._length) {
      return {
        char: '',
        done: true,
      };
    }
    const char = this._rule[this._charIdx + n - 1];
    return {
      char,
      done: false,
    };
  }

  /** 解析后的结构数组 */
  private _structParseResult: TStruct[] = [];

  /** 解析规则字符串为结构数组 */
  private _parseNextStruct() {
    const { char, done } = this._nextChar();
    if (done) {
      return false;
    }
    switch (char) {
      case '/': {
        const { char: nextChar, done: nextDone } = this._peekChar();
        if (!nextDone && nextChar === '/') {
          const { char: nextChar2, done: nextDone2 } = this._peekChar(2);
          if (!nextDone2 && nextChar2 === '/') {
            // 当连续出现 3 个 '/' 时, 认为是一个 '/' 和 一个 '//' 结构相连
            this._structParseResult.push({
              type: '/',
              str: '/',
              startIdx: this._charIdx - 1,
              endIdx: this._charIdx,
            });
            this._nextChar();
          }
          this._structParseResult.push({
            type: '//',
            str: '//',
            startIdx: this._charIdx - 2,
            endIdx: this._charIdx,
          });
          this._nextChar();
        } else {
          this._structParseResult.push({
            type: '/',
            str: '/',
            startIdx: this._charIdx - 1,
            endIdx: this._charIdx,
          });
        }
        break;
      }
      case '?':
        this._structParseResult.push({
          type: '?',
          str: '?',
          startIdx: this._charIdx - 1,
          endIdx: this._charIdx,
        });
        break;
      case '#':
        this._structParseResult.push({
          type: '#',
          str: '#',
          startIdx: this._charIdx - 1,
          endIdx: this._charIdx,
        });
        break;
      case '&':
        this._structParseResult.push({
          type: '&',
          str: '&',
          startIdx: this._charIdx - 1,
          endIdx: this._charIdx,
        });
        break;
      case '\\': {
        const { char: nextChar, done: nextDone } = this._peekChar();
        if (!nextDone && ['i', 'c', 'a', 'd'].includes(nextChar)) {
          this._structParseResult.push({
            type: `\\${nextChar}` as '\\i' | '\\c' | '\\a' | '\\d',
            str: `\\${nextChar}`,
            startIdx: this._charIdx - 1,
            endIdx: this._charIdx + 1,
          });
          this._nextChar();
        } else {
          this._structParseResult.push({
            type: 'unknown',
            str: `\\${char}`,
            startIdx: this._charIdx - 1,
            endIdx: this._charIdx + 1,
          });
          this._nextChar();
        }
        break;
      }
      default: {
        if (/^[a-zA-Z0-9_$-]+$/.test(char)) {
          let str = char;
          while (true) {
            const { char: nextChar, done: nextDone } = this._peekChar();
            if (!nextDone && /^[a-zA-Z0-9_$-]+$/.test(nextChar)) {
              str += nextChar;
              this._nextChar();
            } else {
              break;
            }
          }
          this._structParseResult.push({
            type: 'param',
            str,
            startIdx: this._charIdx - str.length,
            endIdx: this._charIdx,
          });
        } else {
          let str = char;
          while (true) {
            const { char: nextChar, done: nextDone } = this._peekChar();
            if (
              !nextDone &&
              !/^[a-zA-Z0-9_$-]+$/.test(nextChar) &&
              !['/', '?', '#', '&', '\\'].includes(nextChar)
            ) {
              str += nextChar;
              this._nextChar();
            } else {
              break;
            }
          }
          this._structParseResult.push({
            type: 'unknown',
            str,
            startIdx: this._charIdx - str.length,
            endIdx: this._charIdx,
          });
        }
      }
    }
    return true;
  }

  /** 读取结构索引 */
  private _structIdx = 0;

  /** 读取下一个结构 */
  private _nextStruct() {
    const { struct, done } = this._peekStruct();
    if (!done && struct) {
      this._structIdx++;
      return {
        struct,
        done: false,
      } as const;
    }
    return { struct, done };
  }

  /** 预读取下一个结构 */
  private _peekStruct() {
    if (this._structIdx === this._structParseResult.length) {
      if (!this._parseNextStruct()) {
        return {
          struct: null,
          done: true,
        } as const;
      }
    }
    if (this._structIdx < this._structParseResult.length) {
      const struct = this._structParseResult[this._structIdx];
      return {
        struct,
        done: false,
      } as const;
    }
    return {
      struct: null,
      done: true,
    } as const;
  }

  /** 信息 */
  private _info: {
    message: string;
    idx: number;
    endIdx?: number;
    type: 'error' | 'warning' | 'info';
  }[] = [];

  /** 解析 // 区域  */
  private _parsePathname() {
    this._areaDone.pathname = true;

    let currentSegmentRule: 'i' | 'c' | 'a' | 'd' | '' = '';
    let preStructType: TStruct['type'] | null = null;

    while (true) {
      const { struct, done } = this._peekStruct();
      if (done || !struct) {
        if (preStructType === null) {
          this._result.pathname.base = 'c';
        } else {
          this._result.pathname.base = currentSegmentRule || 'i';
        }
        break;
      }
      if (struct.type === '//' || struct.type === '?' || struct.type === '#') {
        if (preStructType === null) {
          this._result.pathname.base = 'c';
        } else {
          this._result.pathname.base = currentSegmentRule || 'i';
        }
        break;
      }
      if (
        struct.type === '\\i' ||
        struct.type === '\\c' ||
        struct.type === '\\a' ||
        struct.type === '\\d'
      ) {
        currentSegmentRule = struct.str.slice(1) as 'i' | 'c' | 'a' | 'd';
        this._result.pathname.segments.push({ rule: currentSegmentRule });
        preStructType = struct.type;
        this._nextStruct();
        continue;
      }
      if (struct.type === '/') {
        if (preStructType?.startsWith('\\')) {
          currentSegmentRule = '';
          preStructType = struct.type;
          this._nextStruct();
          continue;
        }
      }
      break;
    }
  }

  /** 解析 search 区域 */
  private _parseSearch() {
    this._areaDone.search = true;

    let regionRule: 'i' | 'c' | 'a' | 'd' | '' = '';
    let preStructType: TStruct['type'] | null = null;

    while (true) {
      const { struct, done } = this._peekStruct();
      if (done || !struct) {
        if (preStructType === null) {
          this._result.search.base = 'c';
        } else {
          this._result.search.base = regionRule || 'i';
        }
        break;
      }

      if (struct.type === '//' || struct.type === '?' || struct.type === '#') {
        if (preStructType === null) {
          this._result.search.base = 'c';
        } else if (preStructType === '&') {
          // INFO: 这里可能有一个 ts 类型解析解析bug
          // 当 let preStructType: TStruct['type'] | null = null 时, 此处会解析为 let preStructType: "\\i" | "\\c" | "\\a" | "\\d" | "param", 导致 preStructType === '&' 被认为永远不成立
          // 当 let preStructType = null as TStruct['type'] | null 时, 此处会正确解析为 let preStructType: TStruct['type'] | null, 导致 preStructType === '&' 可以正确判断
          this._info.push({
            message: `错误的结束: search区域不能以 '&' 结尾`,
            idx: struct.startIdx - 1,
            endIdx: struct.endIdx,
            type: 'error',
          });
          this._nextStruct();
        } else {
          this._result.search.base = regionRule || 'i';
        }
      }
      if (['\\i', '\\c', '\\a', '\\d'].includes(struct.type)) {
        if (preStructType === '&' || preStructType === null) {
          const currentParamRule = struct.str.slice(1) as 'i' | 'c' | 'a' | 'd';
          this._nextStruct();
          const { struct: nextStruct, done: nextDone } = this._peekStruct();
          if (!nextDone) {
            if (nextStruct.type === 'param') {
              if (this._result.search.params.has(nextStruct.str)) {
                this._info.push({
                  message: `重复的参数规则定义: 参数 ${nextStruct.str} 已经被定义为 \\${this._result.search.params.get(nextStruct.str)}`,
                  idx: nextStruct.startIdx,
                  endIdx: nextStruct.endIdx,
                  type: 'warning',
                });
              } else {
                this._result.search.params.set(nextStruct.str, currentParamRule);
              }
              this._nextStruct();
              preStructType = nextStruct.type;
              continue;
            }
          }
          if (nextDone || ['//', '?', '#', '&'].includes(nextStruct.type)) {
            if (regionRule === '') {
              regionRule = currentParamRule;
              preStructType = struct.type;
            } else {
              this._info.push({
                message: `重复的区域基础规则定义, 区域规则已经被定义为 \\${regionRule}`,
                idx: struct.startIdx,
                endIdx: struct.endIdx,
                type: 'warning',
              });
            }
            continue;
          }
        }
      }
      if (struct.type === '&') {
        if (preStructType?.startsWith('\\') || preStructType === 'param') {
          preStructType = struct.type;
          this._nextStruct();
          continue;
        }
        this._info.push({
          message: `错误的开始: search区域内的参数规则不能以 '&' 开始`,
          idx: struct.startIdx,
          endIdx: struct.endIdx,
          type: 'error',
        });
        break;
      }
      if (struct.type === 'param') {
        if (preStructType === '&' || preStructType === null) {
          if (this._result.search.params.has(struct.str)) {
            this._info.push({
              message: `重复的参数规则定义: 参数 ${struct.str} 已经被定义为 \\${this._result.search.params.get(struct.str)}`,
              idx: struct.startIdx,
              endIdx: struct.endIdx,
              type: 'warning',
            });
          } else {
            this._result.search.params.set(struct.str, 'c');
          }
          preStructType = struct.type;
          this._nextStruct();
          continue;
        }
        this._info.push({
          message: `预期外的参数: ${preStructType} 后面不能直接跟随参数 ${struct.str}，参数必须以 '&' 分隔`,
          idx: struct.startIdx,
          endIdx: struct.endIdx,
          type: 'error',
        });
      }
      break;
    }
  }

  /** 解析 hash 区域 */
  private _parseHash() {
    this._areaDone.hash = true;

    let currentSegmentRule: 'i' | 'c' | 'a' | 'd' | '' = '';
    let preStructType: TStruct['type'] | null = null;

    while (true) {
      const { struct, done } = this._peekStruct();
      if (done || !struct) {
        if (preStructType === null) {
          this._result.hash.base = 'c';
        } else {
          this._result.hash.base = currentSegmentRule || 'i';
        }
        break;
      }
      if (struct.type === '//' || struct.type === '?' || struct.type === '#') {
        if (preStructType === null) {
          this._result.hash.base = 'c';
        } else {
          this._result.hash.base = currentSegmentRule || 'i';
        }
        break;
      }
      if (
        struct.type === '\\i' ||
        struct.type === '\\c' ||
        struct.type === '\\a' ||
        struct.type === '\\d'
      ) {
        currentSegmentRule = struct.str.slice(1) as 'i' | 'c' | 'a' | 'd';
        this._result.hash.segments.push({ rule: currentSegmentRule });
        preStructType = struct.type;
        this._nextStruct();
        continue;
      }
      if (struct.type === '/') {
        if (preStructType?.startsWith('\\')) {
          currentSegmentRule = '';
          preStructType = struct.type;
          this._nextStruct();
          continue;
        }
      }
      break;
    }
  }

  private _parse() {
    while (true) {
      const { struct, done } = this._nextStruct();
      if (done || !struct) {
        break;
      }

      switch (struct.type) {
        case '//':
          if (this._currentArea === 'pathname') {
            this._info.push({
              message: `重复进入 pathname 区域`,
              idx: struct.startIdx,
              endIdx: struct.endIdx,
              type: 'warning',
            });
            this._currentArea = 'ignore';
          } else if (this._areaDone.pathname) {
            this._info.push({
              message: `pathname 区域重复`,
              idx: struct.startIdx,
              endIdx: struct.endIdx,
              type: 'warning',
            });
            this._currentArea = 'ignore';
          } else {
            this._currentArea = 'pathname';
            this._parsePathname();
          }
          break;
        case '?':
          if (this._currentArea === 'search') {
            this._info.push({
              message: `重复进入 search 区域`,
              idx: struct.startIdx,
              endIdx: struct.endIdx,
              type: 'warning',
            });
            this._currentArea = 'ignore';
          } else if (this._areaDone.search) {
            this._info.push({
              message: `search 区域重复`,
              idx: struct.startIdx,
              endIdx: struct.endIdx,
              type: 'warning',
            });
            this._currentArea = 'ignore';
          } else {
            this._currentArea = 'search';
            this._parseSearch();
          }
          break;
        case '#':
          if (this._currentArea === 'hash') {
            this._info.push({
              message: `重复进入 hash 区域`,
              idx: struct.startIdx,
              endIdx: struct.endIdx,
              type: 'warning',
            });
            this._currentArea = 'ignore';
          } else if (this._areaDone.hash) {
            this._info.push({
              message: `hash 区域重复`,
              idx: struct.startIdx,
              endIdx: struct.endIdx,
              type: 'warning',
            });
            this._currentArea = 'ignore';
          } else {
            this._currentArea = 'hash';
            this._parseHash();
          }
          break;
        default: {
          const errorRegion: TStruct[] = [];
          while (true) {
            const { struct: nextStruct, done: nextDone } = this._peekStruct();
            if (nextDone || !nextStruct) {
              break;
            } else if (
              nextStruct.type === '//' ||
              nextStruct.type === '?' ||
              nextStruct.type === '#'
            ) {
              break;
            }
            errorRegion.push(nextStruct);
            this._nextStruct();
          }
          this._info.push({
            message: `区域外的规则: ${struct.str}${errorRegion.map((r) => r.str).join('')}. 规则必须在 //、?、# 之后定义`,
            idx: struct.startIdx,
            endIdx:
              errorRegion.length > 0 ? errorRegion[errorRegion.length - 1].endIdx : struct.endIdx,
            type: 'warning',
          });
        }
      }
    }
  }

  public parse(rule: string) {
    this._rule = rule;
    this._length = rule.length;
    this._reset();
    this._parse();
    const errorCount = this._info.filter((i) => i.type === 'error').length;
    const warningCount = this._info.filter((i) => i.type === 'warning').length;
    return {
      result: this._result,
      info: this._info,
      // error 表示规则字符串存在无法解析的错误, 需要修正后才能正确使用
      // warning 表示规则字符串存在潜在的问题或不规范的用法, 建议修正以避免潜在问题
      // success 表示规则字符串没有明显的错误或问题
      state: errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'success',
    };
  }
}

export { RefreshRuleParser };
