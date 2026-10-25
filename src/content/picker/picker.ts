/**
 * Element picker and zapper, injected on demand from the popup, the context
 * menu or the keyboard shortcut.
 *
 * Picker: hover to highlight, click to choose, pick one of the generated
 * selectors, preview, then save it as a cosmetic filter for this site.
 * Zapper: click to remove elements until the page reloads.
 *
 * The UI lives in a closed shadow root so page styles can't affect it and page
 * scripts can't reach into it.
 */
import { sendMessage } from '../../shared/messages';
import { candidateSelectors, type Candidate } from './selector';

declare global {
  interface Window {
    __shomerPickerMode?: string;
    __shomerPickerActive?: boolean;
  }
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
.highlight { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px solid #2563eb;
  background: rgba(37, 99, 235, .18); border-radius: 3px; transition: all 60ms ease-out; display: none; }
.highlight.zap { border-color: #dc2626; background: rgba(220, 38, 38, .18); }
.tag { position: fixed; pointer-events: none; z-index: 2147483647; background: #0f172a; color: #f8fafc;
  font: 12px/1.4 ui-monospace, Menlo, monospace; padding: 2px 6px; border-radius: 4px; display: none; max-width: 60vw;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel { position: fixed; right: 16px; bottom: 16px; width: 380px; max-width: calc(100vw - 32px); z-index: 2147483647;
  background: #ffffff; color: #0f172a; border-radius: 12px; box-shadow: 0 10px 40px rgba(15,23,42,.35);
  border: 1px solid #e2e8f0; padding: 14px; font-size: 13px; }
.panel h2 { margin: 0 0 4px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.panel p { margin: 0 0 10px; color: #475569; }
.list { max-height: 180px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 10px; }
.list label { display: flex; gap: 8px; align-items: flex-start; padding: 7px 9px; cursor: pointer; border-bottom: 1px solid #f1f5f9; }
.list label:last-child { border-bottom: 0; }
.list code { font: 12px/1.4 ui-monospace, Menlo, monospace; word-break: break-all; flex: 1; }
.count { color: #64748b; font-size: 11px; white-space: nowrap; }
.row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
button { font: inherit; border-radius: 8px; padding: 7px 12px; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; cursor: pointer; }
button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
button:disabled { opacity: .5; cursor: default; }
.preview { display: flex; gap: 6px; align-items: center; color: #334155; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: #0f172a; color: #f8fafc;
  padding: 10px 16px; border-radius: 10px; z-index: 2147483647; font-size: 13px; }
@media (prefers-color-scheme: dark) {
  .panel { background: #0f172a; color: #e2e8f0; border-color: #1e293b; }
  .panel p, .preview { color: #94a3b8; }
  .list, .list label { border-color: #1e293b; }
  button { background: #1e293b; color: #e2e8f0; border-color: #334155; }
}
`;

/** Builds an element without innerHTML: page-derived text is always a text node. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function start(mode: 'picker' | 'zapper'): void {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = el('style');
  style.textContent = STYLE;
  const highlight = el('div', 'highlight');
  const tag = el('div', 'tag');
  root.append(style, highlight, tag);
  document.documentElement.appendChild(host);
  if (mode === 'zapper') highlight.classList.add('zap');

  let hovered: Element | null = null;
  let chosen: Element | null = null;
  let previewed: HTMLElement[] = [];
  /** Confirms the current choice; set while the panel is open. */
  let confirm: (() => void) | null = null;

  const elementAt = (x: number, y: number): Element | null =>
    document
      .elementsFromPoint(x, y)
      .find((el) => el !== host && el !== document.documentElement && el !== document.body) ?? null;

  const outline = (el: Element | null) => {
    if (!el) {
      highlight.style.display = tag.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: 'block',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    tag.textContent = `${el.localName}${el.id ? `#${el.id}` : ''}${Array.from(el.classList)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('')}`;
    Object.assign(tag.style, {
      display: 'block',
      left: `${Math.max(4, r.left)}px`,
      top: `${Math.max(4, r.top - 24)}px`,
    });
  };

  const clearPreview = () => {
    for (const el of previewed) el.style.removeProperty('display');
    previewed = [];
  };

  const toast = (text: string) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    root.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  };

  const stop = () => {
    clearPreview();
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    window.__shomerPickerActive = false;
    setTimeout(() => host.remove(), 2600);
    outline(null);
    root.querySelector('.panel')?.remove();
  };

  const showPanel = (target: Element) => {
    const candidates: Candidate[] = candidateSelectors(target);
    let selected = candidates[0]?.selector ?? '';
    const pv = el('input', '', { type: 'checkbox' });
    const back = el('button', '', {}, 'Pick again');
    const cancel = el('button', '', {}, 'Cancel');
    const create = el('button', 'primary', {}, 'Create');
    const list = el('div', 'list');
    const panel = el(
      'div',
      'panel',
      {},
      el('h2', '', {}, '🛡️ Block element'),
      el(
        'p',
        '',
        {},
        'Choose how broadly to match. Shomer will hide matching elements on ',
        el('b', '', {}, location.hostname),
        '.',
      ),
      list,
      el('div', 'row', {}, el('label', 'preview', {}, pv, ' Preview'), el('div', 'row', {}, back, cancel, create)),
    );
    panel.style.pointerEvents = 'auto';
    candidates.forEach((c, i) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'sel';
      radio.checked = i === 0;
      const code = document.createElement('code');
      code.textContent = c.selector;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = c.count === 1 ? '1 element' : `${c.count} elements`;
      radio.addEventListener('change', () => {
        selected = c.selector;
        if (pv.checked) preview();
      });
      label.append(radio, code, count);
      list.appendChild(label);
    });
    const preview = () => {
      clearPreview();
      if (!pv.checked || !selected) return;
      previewed = Array.from(document.querySelectorAll<HTMLElement>(selected));
      for (const p of previewed) p.style.setProperty('display', 'none', 'important');
    };
    pv.addEventListener('change', preview);
    cancel.addEventListener('click', stop);
    back.addEventListener('click', () => {
      confirm = null;
      clearPreview();
      panel.remove();
      chosen = null;
    });
    create.disabled = selected === '';
    confirm = () => create.click();
    create.addEventListener('click', async () => {
      create.disabled = true;
      try {
        const result = await sendMessage('picker:create', { selector: selected });
        toast(result.ok ? `Filter added: ${result.filter}` : 'Could not add this filter.');
      } catch {
        toast('Could not add this filter.');
      }
      stop();
    });
    root.appendChild(panel);
  };

  // The shadow root is closed, so events from inside it are retargeted to the
  // host. The host itself is click-through; only the panel can produce them.
  const inPanel = (ev: Event) => ev.target === host;

  function onMove(ev: MouseEvent) {
    if (chosen) return;
    hovered = elementAt(ev.clientX, ev.clientY);
    outline(hovered);
  }

  function onClick(ev: MouseEvent) {
    if (inPanel(ev)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (chosen) return;
    const target = elementAt(ev.clientX, ev.clientY);
    if (!target) return;
    if (mode === 'zapper') {
      target.remove();
      outline(null);
      return;
    }
    chosen = target;
    outline(target);
    showPanel(target);
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      stop();
    } else if (ev.key === 'Enter' && confirm) {
      ev.preventDefault();
      confirm();
    }
  }

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  toast(
    mode === 'zapper'
      ? 'Zapper: click elements to remove them. Esc to exit.'
      : 'Click the element to block. Esc to cancel.',
  );
}

if (!window.__shomerPickerActive) {
  window.__shomerPickerActive = true;
  start(window.__shomerPickerMode === 'zapper' ? 'zapper' : 'picker');
}
