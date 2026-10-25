/** Tiny DOM helpers for the extension pages (no framework needed). */

type Props = Record<string, string | number | boolean | EventListener | undefined | null>;
type Child = Node | string | number | null | undefined | false;

/**
 * `h('button', { class: 'btn', onclick: fn }, 'Save')`. Text children are
 * inserted as text nodes, never as HTML, so page-derived strings (domains,
 * selectors) can't inject markup.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (key in el && typeof value !== 'string') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export function toggle(
  checked: boolean,
  onChange: (value: boolean) => void,
  label: string,
  disabled = false,
): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', checked, disabled, 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span'));
}

export function segmented<T extends string>(
  options: { value: T; label: string; title?: string }[],
  current: T | null,
  onChange: (value: T) => void,
  label: string,
): HTMLDivElement {
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const o of options) {
    const button = h(
      'button',
      { type: 'button', 'data-value': o.value, 'aria-pressed': String(o.value === current), title: o.title ?? o.label },
      o.label,
    );
    button.addEventListener('click', () => {
      group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      onChange(o.value);
    });
    group.append(button);
  }
  return group;
}

export function toast(message: string): void {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: n >= 10000 ? 'compact' : 'standard' }).format(n);
}
