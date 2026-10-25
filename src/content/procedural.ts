/**
 * Procedural cosmetic filters.
 *
 * Some elements can't be targeted with CSS alone, e.g. "the card whose text
 * contains 'Sponsored'". uBO and ABP extend selector syntax with operators
 * such as `:has-text()`, `:upward()` and `:matches-css()`; this module parses
 * such selectors into a small pipeline and evaluates it against the DOM.
 */
import { PROCEDURAL_OPERATORS } from '../shared/filters/parser';

type Op =
  | { type: 'spath'; css: string }
  | { type: 'has-text'; re: RegExp }
  | { type: 'has'; task: Task }
  | { type: 'not'; task: Task }
  | { type: 'upward'; steps: number; selector: string }
  | { type: 'matches-css'; pseudo: string | null; property: string; re: RegExp }
  | { type: 'min-text-length'; min: number }
  | { type: 'matches-path'; re: RegExp }
  | { type: 'matches-attr'; name: RegExp; value: RegExp | null }
  | { type: 'xpath'; expression: string };

export type Action =
  | { type: 'hide' }
  | { type: 'remove' }
  | { type: 'style'; declarations: [string, string][] }
  | { type: 'remove-attr'; name: string }
  | { type: 'remove-class'; name: string };

export interface Task {
  base: string;
  ops: Op[];
  action: Action;
}

const OPERATOR_NAMES = new Set(
  [...PROCEDURAL_OPERATORS, ':style('].map((o) => o.replace(/^:/, '').replace(/\(\)?$/, '')).concat(['has', 'not']),
);

/** Index of the parenthesis closing the one at `open`, honouring quotes and escapes. */
function findClosing(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
    } else if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth++;
    } else if (c === ')' && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/** `/regex/flags` or a literal substring. */
export function textPattern(arg: string, flags = ''): RegExp {
  const m = /^\/(.+)\/([gimsu]*)$/.exec(arg);
  if (m?.[1] !== undefined) {
    try {
      return new RegExp(m[1], m[2] ?? flags);
    } catch {
      /* treat as literal */
    }
  }
  const literal = arg.replace(/^(["'])(.*)\1$/, '$2');
  return new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
}

/** ABP-style CSS value pattern: `*` is a wildcard, `/re/` a regex. */
function cssValuePattern(arg: string): RegExp {
  if (/^\/.+\/[gimsu]*$/.test(arg)) return textPattern(arg);
  const escaped = arg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function isProcedural(arg: string): boolean {
  return [...PROCEDURAL_OPERATORS].some((o) => arg.includes(o));
}

function parseDeclarations(text: string): [string, string][] {
  return text
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.includes(':') && !/url\s*\(/i.test(d))
    .map((d) => {
      const colon = d.indexOf(':');
      return [
        d.slice(0, colon).trim(),
        d
          .slice(colon + 1)
          .replace(/!important\s*$/i, '')
          .trim(),
      ] as [string, string];
    });
}

export function parseProcedural(selector: string): Task | null {
  const ops: Op[] = [];
  let base = '';
  let css = '';
  let action: Action = { type: 'hide' };
  let sawProcedural = false;

  const flushCss = () => {
    if (!sawProcedural) base = css.trim();
    else if (css.trim() !== '' || /^\s/.test(css)) ops.push({ type: 'spath', css });
    css = '';
  };

  let i = 0;
  while (i < selector.length) {
    const c = selector[i];
    if (c === '[') {
      // Copy attribute selectors verbatim.
      let j = i + 1;
      let quote: string | null = null;
      for (; j < selector.length; j++) {
        const d = selector[j];
        if (quote) {
          if (d === quote) quote = null;
        } else if (d === '"' || d === "'") quote = d;
        else if (d === ']') break;
      }
      css += selector.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ':') {
      const m = /^:([\w-]+)\(/.exec(selector.slice(i));
      if (m?.[1]) {
        const name = m[1];
        const open = i + name.length + 1;
        const close = findClosing(selector, open);
        if (close === -1) return null;
        const arg = selector.slice(open + 1, close).trim();
        const procedural = OPERATOR_NAMES.has(name) && (name === 'has' || name === 'not' ? isProcedural(arg) : true);
        if (procedural) {
          flushCss();
          sawProcedural = true;
          const op = makeOp(name, arg);
          if (op === null) return null;
          if ('action' in op) action = op.action;
          else if (op.op) ops.push(op.op);
          i = close + 1;
          continue;
        }
        css += selector.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }
    css += c;
    i++;
  }
  flushCss();
  return { base, ops, action };
}

function makeOp(name: string, arg: string): { op: Op | null } | { action: Action } | null {
  switch (name) {
    case 'has-text':
    case 'contains':
    case '-abp-contains':
      return { op: { type: 'has-text', re: textPattern(arg) } };
    case 'has':
    case '-abp-has': {
      const task = parseProcedural(arg);
      return task ? { op: { type: 'has', task } } : null;
    }
    case 'not': {
      const task = parseProcedural(arg);
      return task ? { op: { type: 'not', task } } : null;
    }
    case 'upward': {
      const n = Number(arg);
      if (Number.isInteger(n) && n >= 1 && n < 256) return { op: { type: 'upward', steps: n, selector: '' } };
      return { op: { type: 'upward', steps: 0, selector: arg } };
    }
    case 'matches-css':
    case 'matches-css-before':
    case 'matches-css-after': {
      const colon = arg.indexOf(':');
      if (colon === -1) return null;
      const pseudo = name === 'matches-css' ? null : name.endsWith('before') ? '::before' : '::after';
      return {
        op: {
          type: 'matches-css',
          pseudo,
          property: arg.slice(0, colon).trim(),
          re: cssValuePattern(arg.slice(colon + 1).trim()),
        },
      };
    }
    case 'min-text-length':
      return { op: { type: 'min-text-length', min: Number(arg) || 0 } };
    case 'matches-path':
      return { op: { type: 'matches-path', re: textPattern(arg) } };
    case 'matches-attr': {
      const m = /^("?)(.+?)\1(?:=("?)(.*)\3)?$/.exec(arg);
      if (!m?.[2]) return null;
      return {
        op: {
          type: 'matches-attr',
          name: cssValuePattern(m[2]),
          value: m[4] !== undefined ? cssValuePattern(m[4]) : null,
        },
      };
    }
    case 'xpath':
      return { op: { type: 'xpath', expression: arg } };
    case 'remove':
      return { action: { type: 'remove' } };
    case 'style':
      return { action: { type: 'style', declarations: parseDeclarations(arg) } };
    case 'remove-attr':
      return { action: { type: 'remove-attr', name: arg.replace(/^(["'])(.*)\1$/, '$2') } };
    case 'remove-class':
      return { action: { type: 'remove-class', name: arg.replace(/^(["'])(.*)\1$/, '$2') } };
    case 'watch-attr':
    case 'others':
    case 'matches-prop':
      return { op: null };
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                   */
/* -------------------------------------------------------------------------- */

function relativeQuery(el: Element, css: string): Element[] {
  const trimmed = css.trim();
  if (trimmed === '') return [el];
  try {
    if (trimmed.startsWith('+')) {
      const next = el.nextElementSibling;
      return next && next.matches(trimmed.slice(1).trim()) ? [next] : [];
    }
    if (trimmed.startsWith('~')) {
      const rest = trimmed.slice(1).trim();
      const out: Element[] = [];
      for (let s = el.nextElementSibling; s; s = s.nextElementSibling) if (s.matches(rest)) out.push(s);
      return out;
    }
    if (trimmed.startsWith('>') || /^\s/.test(css)) return Array.from(el.querySelectorAll(`:scope ${trimmed}`));
    // Attached to the previous compound selector: `div:has-text(x).ad`
    return el.matches(`*${trimmed}`) ? [el] : [];
  } catch {
    return [];
  }
}

function applyOp(op: Op, nodes: Element[]): Element[] {
  switch (op.type) {
    case 'spath':
      return nodes.flatMap((n) => relativeQuery(n, op.css));
    case 'has-text':
      return nodes.filter((n) => op.re.test(n.textContent ?? ''));
    case 'has':
      return nodes.filter((n) => runRelative(op.task, n).length > 0);
    case 'not':
      return nodes.filter((n) => !matchesSelf(op.task, n));
    case 'upward':
      return nodes
        .map((n) => {
          if (op.selector) return n.parentElement?.closest(op.selector) ?? null;
          let cur: Element | null = n;
          for (let i = 0; i < op.steps && cur; i++) cur = cur.parentElement;
          return cur;
        })
        .filter((n): n is Element => n !== null && n !== document.documentElement);
    case 'matches-css':
      return nodes.filter((n) => op.re.test(getComputedStyle(n, op.pseudo).getPropertyValue(op.property)));
    case 'min-text-length':
      return nodes.filter((n) => (n.textContent ?? '').length >= op.min);
    case 'matches-path':
      return op.re.test(location.pathname + location.search) ? nodes : [];
    case 'matches-attr':
      return nodes.filter((n) =>
        Array.from(n.attributes).some((a) => op.name.test(a.name) && (op.value === null || op.value.test(a.value))),
      );
    case 'xpath':
      return nodes.flatMap((n) => {
        const out: Element[] = [];
        try {
          const result = document.evaluate(op.expression, n, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < result.snapshotLength; i++) {
            const item = result.snapshotItem(i);
            if (item instanceof Element) out.push(item);
          }
        } catch {
          /* invalid expression */
        }
        return out;
      });
  }
}

function runOps(task: Task, nodes: Element[]): Element[] {
  let current = nodes;
  for (const op of task.ops) {
    if (current.length === 0) break;
    current = [...new Set(applyOp(op, current))];
  }
  return current;
}

/** Evaluates a task relative to `el` (used by `:has()`). */
function runRelative(task: Task, el: Element): Element[] {
  const start = task.base ? relativeQuery(el, /^[>+~]/.test(task.base) ? task.base : ` ${task.base}`) : [el];
  return runOps(task, start);
}

/** Whether `el` itself satisfies the task (used by `:not()`). */
function matchesSelf(task: Task, el: Element): boolean {
  try {
    if (task.base && !el.matches(task.base)) return false;
  } catch {
    return false;
  }
  return runOps(task, [el]).includes(el);
}

export function selectElements(task: Task, root: Document = document): Element[] {
  let start: Element[];
  try {
    start = task.base ? Array.from(root.querySelectorAll(task.base)) : [root.documentElement];
  } catch {
    return [];
  }
  return runOps(task, start);
}

export function applyAction(action: Action, el: Element): void {
  const html = el as HTMLElement;
  switch (action.type) {
    case 'hide':
      html.style?.setProperty('display', 'none', 'important');
      break;
    case 'remove':
      el.remove();
      break;
    case 'style':
      for (const [prop, value] of action.declarations) html.style?.setProperty(prop, value, 'important');
      break;
    case 'remove-attr':
      el.removeAttribute(action.name);
      break;
    case 'remove-class':
      el.classList.remove(action.name);
      break;
  }
}

/** Runs procedural filters now and whenever the DOM changes (throttled). */
export function startProcedural(selectors: string[]): void {
  const tasks = selectors.map(parseProcedural).filter((t): t is Task => t !== null);
  if (tasks.length === 0) return;
  let scheduled = false;
  let lastRun = 0;
  const run = () => {
    scheduled = false;
    lastRun = performance.now();
    for (const task of tasks) {
      for (const el of selectElements(task)) applyAction(task.action, el);
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    // At most ~5 runs per second, however busy the page is.
    setTimeout(run, Math.max(0, 200 - (performance.now() - lastRun)));
  };
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true, characterData: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}
