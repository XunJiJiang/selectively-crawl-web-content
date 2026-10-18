export type MenuPresentationMode = 'native' | 'custom' | 'auto';
export type ResolvedMenuPresentation = Exclude<MenuPresentationMode, 'auto'>;
export interface ContextMenuAction {
  kind: 'action';
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  keepOpen?: boolean;
  action: () => void | Promise<void>;
  onDisabledSelect?: () => void;
}

export interface ContextMenuSubmenu {
  kind: 'submenu';
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  children: ContextMenuItem[];
}

export interface ContextMenuCheckbox {
  kind: 'checkbox';
  id: string;
  label: string;
  icon?: string;
  checked: boolean;
  disabled?: boolean;
  keepOpen?: boolean;
  action: (value: boolean) => void | Promise<void>;
}

export interface ContextMenuInput {
  kind: 'input';
  id: string;
  label: string;
  icon?: string;
  inputType: 'text' | 'number';
  value: string;
  placeholder?: string;
  action: (value: string) => void | Promise<void>;
}

export interface ContextMenuSeparator {
  kind: 'separator';
  id: string;
}

export type ContextMenuItem =
  | ContextMenuAction
  | ContextMenuSubmenu
  | ContextMenuCheckbox
  | ContextMenuInput
  | ContextMenuSeparator;
