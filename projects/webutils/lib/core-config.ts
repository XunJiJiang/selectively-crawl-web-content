import {
  isCoreWebConfigChannel,
  readCoreWebConfigMessage,
  type CoreWebConfig,
  type CoreWebConfigChannel,
  type CoreWebConfigMessage,
  type CoreWebConfigValues,
} from '../../shared/core-web-config.ts';
import type { InstancePort } from '../../shared/workbench-protocol.ts';

/** 每个插件文档独立注册；连接重建时重新订阅，不要求重新创建页面。 */
export function createCoreConfigSubscriptions(hosted: boolean) {
  type Listener = (value: CoreWebConfigValues[CoreWebConfigChannel]) => void;
  const listeners = new Map<CoreWebConfigChannel, Set<Listener>>();
  const snapshots = new Map<CoreWebConfigChannel, CoreWebConfigMessage>();
  let port: InstancePort | undefined;
  let generation = 0;
  let disposed = false;
  const deliver = (listener: Listener, value: CoreWebConfigMessage['value']) => {
    try {
      listener(value);
    } catch (error) {
      console.error('核心 Web 配置监听失败', error);
    }
  };
  const receive = (input: unknown) => {
    if (disposed) {
      return;
    }
    const message = readCoreWebConfigMessage(input);
    if (!message) {
      return;
    }
    const selected = listeners.get(message.channel);
    if (!selected || message.revision <= (snapshots.get(message.channel)?.revision ?? -1)) {
      return;
    }
    snapshots.set(message.channel, message);
    for (const listener of [...selected]) {
      if (selected.has(listener)) {
        deliver(listener, message.value);
      }
    }
  };
  const register = (channel: CoreWebConfigChannel) => {
    if (!port) {
      return;
    }
    const currentPort = port,
      currentGeneration = generation,
      selected = listeners.get(channel);
    void currentPort
      .request('core-config.subscribe', { channel })
      .then((message) => {
        if (!disposed && generation === currentGeneration && listeners.get(channel) === selected) {
          receive(message);
        }
      })
      .catch((error) => {
        if (!disposed && generation === currentGeneration && listeners.get(channel) === selected) {
          console.error('核心 Web 配置订阅失败', error);
        }
      });
  };
  const api: CoreWebConfig = {
    subscribe(channel, listener) {
      if (!hosted) {
        throw new Error('核心 Web 配置仅在工作台内可用');
      }
      if (disposed) {
        throw new Error('插件文档已释放');
      }
      if (!isCoreWebConfigChannel(channel)) {
        throw new Error('未公开的核心 Web 配置通道');
      }
      if (typeof listener !== 'function') {
        throw new Error('缺少核心 Web 配置监听回调');
      }
      let selected = listeners.get(channel);
      const first = !selected;
      if (!selected) {
        listeners.set(channel, (selected = new Set()));
      }
      // 包装使重复注册同一个函数仍拥有独立的注销生命周期。
      const callback: Listener = (value) => listener(value);
      selected.add(callback);
      const snapshot = snapshots.get(channel);
      if (snapshot) {
        deliver(callback, snapshot.value);
      }
      if (first) {
        register(channel);
      }
      return () => {
        if (!selected.delete(callback) || selected.size) {
          return;
        }
        listeners.delete(channel);
        snapshots.delete(channel);
        port?.event('core-config.unsubscribe', { channel });
      };
    },
  };
  return {
    api,
    receive,
    connect(next: InstancePort) {
      if (disposed) {
        return;
      }
      port = next;
      generation++;
      snapshots.clear();
      for (const channel of listeners.keys()) {
        register(channel);
      }
    },
    dispose() {
      disposed = true;
      generation++;
      listeners.clear();
      snapshots.clear();
      port = undefined;
    },
  };
}
