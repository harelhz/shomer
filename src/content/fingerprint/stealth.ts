/**
 * "Stealth" patching.
 *
 * A common anti-anti-fingerprinting trick is to check whether a built-in has
 * been tampered with: `HTMLCanvasElement.prototype.toDataURL.toString()` should
 * be `function toDataURL() { [native code] }`. We wrap built-ins in Proxies,
 * which keep their `name`, `length` and non-constructibility, and patch
 * `Function.prototype.toString` (itself proxied) to report the original source.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type AnyFn = (...args: any[]) => any;

/** wrapper → original, shared by every frame we patch. */
const originals = new WeakMap<object, AnyFn>();
const patchedRealms = new WeakSet<object>();

const reflectApply = Reflect.apply;
const getDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;

export function maskToString(win: Window & typeof globalThis): void {
  const proto = win.Function.prototype;
  if (patchedRealms.has(proto)) return;
  patchedRealms.add(proto);
  const desc = getDescriptor(proto, 'toString');
  const original = desc?.value as AnyFn | undefined;
  if (!desc || typeof original !== 'function') return;
  const proxy = new Proxy(original, {
    apply(target, thisArg, args) {
      return reflectApply(target, originals.get(thisArg) ?? thisArg, args);
    },
  });
  originals.set(proxy, original);
  defineProperty(proto, 'toString', { ...desc, value: proxy });
}

export function wrapFunction<T extends AnyFn>(original: T, apply: (target: T, thisArg: any, args: any[]) => any): T {
  const proxy = new Proxy(original, { apply });
  originals.set(proxy, original);
  return proxy;
}

/** Replaces a method on a prototype with a stealth wrapper. */
export function patchMethod(
  owner: object | undefined,
  name: string,
  apply: (original: AnyFn, thisArg: any, args: any[]) => any,
): void {
  if (!owner) return;
  const desc = getDescriptor(owner, name);
  if (!desc || typeof desc.value !== 'function' || originals.has(desc.value)) return;
  defineProperty(owner, name, { ...desc, value: wrapFunction(desc.value as AnyFn, apply) });
}

/** Replaces an accessor's getter with a stealth wrapper. */
export function patchGetter(
  owner: object | undefined,
  name: string,
  get: (original: () => any, thisArg: any) => any,
): void {
  if (!owner) return;
  const desc = getDescriptor(owner, name);
  if (!desc || typeof desc.get !== 'function' || originals.has(desc.get)) return;
  const originalGet = desc.get as () => any;
  const wrapped = wrapFunction(originalGet, (target, thisArg) => get(target, thisArg));
  defineProperty(owner, name, { ...desc, get: wrapped });
}

export function isPatched(fn: unknown): boolean {
  return typeof fn === 'function' && originals.has(fn);
}
