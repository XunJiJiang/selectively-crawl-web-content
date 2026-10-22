export interface DialogField {
  name: string;
  label: string;
  value: string;
  options?: { value: string; label: string }[];
}
export interface WorkbenchDialog {
  title: string;
  fields: DialogField[];
  resolve: (value: Record<string, string> | null) => void;
}
