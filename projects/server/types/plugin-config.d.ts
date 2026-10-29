export interface ConfigChange {
  pluginId: string;
  changedKeys: string[];
  effectiveValues: Record<string, string>;
  revision: number;
  schemaRevision: number;
  originRequestId?: string;
}
export interface ConfigSnapshot {
  values: Record<string, string>;
  effectiveValues: Record<string, string>;
  revision: number;
  schemaRevision: number;
  definitions: ConfigDefinition[];
  definitionSources?: Record<string, 'backend' | 'legacy-unverified'>;
}
export interface ConfigDefinition {
  id: string;
  schemaVersion: string;
  items: {
    id: string;
    key: string;
    label: string;
    description?: string;
    control: 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'color' | 'readonly';
    defaultValue?: string;
    validationPolicy?: 'declarative' | 'page-required' | 'backend-required';
    rules?: {
      codec?: 'string' | 'integer' | 'number' | 'boolean';
      min?: number;
      max?: number;
      maxLength?: number;
      options?: string[];
    };
  }[];
}
/** Persistent strings, isolated to the current plugin directory. No JSON coercion. */
export interface PluginConfig {
  get(key: string): Promise<string | undefined>;
  list(): Promise<ConfigSnapshot>;
  set(key: string, value: string, options?: { baseRevision?: number }): Promise<ConfigSnapshot>;
  update(
    values: Record<string, string>,
    options?: { baseRevision?: number },
  ): Promise<ConfigSnapshot>;
  delete(key: string, options?: { baseRevision?: number }): Promise<ConfigSnapshot>;
  reset(keys: string[], options?: { baseRevision?: number }): Promise<ConfigSnapshot>;
  subscribe(listener: (change: ConfigChange) => void): () => void;
}
