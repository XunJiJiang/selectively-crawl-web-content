// oxlint-disable typescript/no-explicit-any
import { customElement as litCustomElement, type CustomElementDecorator } from 'lit/decorators.js';

export function customElement(tagName: string): CustomElementDecorator {
  return function (target: any) {
    if (!customElements.get(tagName)) {
      litCustomElement(tagName)(target);
    }
  };
}
