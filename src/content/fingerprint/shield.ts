/**
 * Fingerprint shield — runs in the page's MAIN world at document_start.
 *
 * Standard level: canvas, WebGL readback and Web Audio get deterministic noise
 * (see noise.ts), which is what CanvasBlocker-style protection does.
 * Strict level additionally: DOMRect / TextMetrics noise (font
 * fingerprinting), a generic WebGL vendor/renderer, and normalised
 * `hardwareConcurrency` / `deviceMemory`.
 *
 * Same-origin frames are protected too, including the classic bypass of
 * creating an `about:blank` iframe and using its pristine prototypes before
 * any content script has run in it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FP_EVENT } from '../../shared/constants';
import { noisifyMeasurement, noisifyPixels, noisifySamples, randomSeed } from './noise';
import { maskToString, patchGetter, patchMethod, wrapFunction } from './stealth';

export type ShieldLevel = 'standard' | 'strict';
type Win = Window & typeof globalThis;

const reflectApply = Reflect.apply;
// Captured before we patch anything: the pristine toString of this realm.
const nativeToString = Function.prototype.toString;
const seed = randomSeed();
const protectedWindows = new WeakSet<object>();
const textCanvases = new WeakSet<object>();
const noisedAudio = new WeakMap<object, Set<number>>();

const UNMASKED_VENDOR_WEBGL = 0x9245;
const UNMASKED_RENDERER_WEBGL = 0x9246;

/* -------------------------------------------------------------------------- */
/* Reporting                                                                    */
/* -------------------------------------------------------------------------- */

const reported = new Set<string>();
const dispatch = EventTarget.prototype.dispatchEvent;
const CustomEventCtor = CustomEvent;
const stringify = JSON.stringify;

/** First script URL in the call stack that isn't ours. */
function callerScript(): string {
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n')) {
    const m = /((?:https?|blob):\/\/[^\s)]+?)(?::\d+){1,2}\)?\s*$/.exec(line);
    if (m?.[1]) return m[1].startsWith('blob:') ? m[1].slice(5) : m[1];
  }
  return '';
}

/**
 * Tells the isolated-world content script what happened. The detail is a
 * string because objects don't cross the world boundary.
 */
function report(api: string): void {
  const script = callerScript();
  const key = `${api}|${script}`;
  if (reported.has(key)) return;
  reported.add(key);
  try {
    reflectApply(dispatch, document, [new CustomEventCtor(FP_EVENT, { detail: stringify({ api, script }) })]);
  } catch {
    /* never let reporting break the page */
  }
}

/* -------------------------------------------------------------------------- */
/* Canvas                                                                       */
/* -------------------------------------------------------------------------- */

function protectCanvas(win: Win): void {
  const canvasProto = win.HTMLCanvasElement?.prototype;
  const ctx2dProto = win.CanvasRenderingContext2D?.prototype;
  const offscreenProto = (win as any).OffscreenCanvas?.prototype;
  const offscreenCtxProto = (win as any).OffscreenCanvasRenderingContext2D?.prototype;
  if (!canvasProto || !ctx2dProto) return;

  const getContext = canvasProto.getContext;
  const getImageData = ctx2dProto.getImageData;
  const putImageData = ctx2dProto.putImageData;
  const drawImage = ctx2dProto.drawImage;
  const createElement = win.Document.prototype.createElement;
  const widthGetter = Object.getOwnPropertyDescriptor(canvasProto, 'width')?.get;
  const heightGetter = Object.getOwnPropertyDescriptor(canvasProto, 'height')?.get;

  // Remember which canvases had text drawn on them: text rendering is the
  // signature of canvas fingerprinting (it exposes fonts and anti-aliasing).
  for (const proto of [ctx2dProto, offscreenCtxProto]) {
    for (const method of ['fillText', 'strokeText']) {
      patchMethod(proto, method, (original, thisArg, args) => {
        try {
          textCanvases.add(thisArg.canvas);
        } catch {
          /* ignore */
        }
        return reflectApply(original, thisArg, args);
      });
    }
  }

  /** Returns a noised copy of a canvas, or null if it's empty. */
  function noisedCopy(source: HTMLCanvasElement): HTMLCanvasElement | null {
    const width = widthGetter ? reflectApply(widthGetter, source, []) : source.width;
    const height = heightGetter ? reflectApply(heightGetter, source, []) : source.height;
    if (!width || !height) return null;
    const copy = reflectApply(createElement, document, ['canvas']) as HTMLCanvasElement;
    copy.width = width;
    copy.height = height;
    const ctx = reflectApply(getContext, copy, ['2d']) as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    reflectApply(drawImage, ctx, [source, 0, 0]);
    const image = reflectApply(getImageData, ctx, [0, 0, width, height]) as ImageData;
    noisifyPixels(image.data, width, height, 0, 0, seed);
    reflectApply(putImageData, ctx, [image, 0, 0]);
    return copy;
  }

  const readApi = (canvas: unknown) => (textCanvases.has(canvas as object) ? 'canvas-text' : 'canvas');

  for (const method of ['toDataURL', 'toBlob']) {
    patchMethod(canvasProto, method, (original, thisArg, args) => {
      let target = thisArg;
      try {
        report(readApi(thisArg));
        target = noisedCopy(thisArg) ?? thisArg;
      } catch {
        // Tainted canvases throw a SecurityError from the original call below,
        // exactly as they would without us.
      }
      return reflectApply(original, target, args);
    });
  }

  patchMethod(ctx2dProto, 'getImageData', (original, thisArg, args) => {
    const image = reflectApply(original, thisArg, args) as ImageData;
    try {
      report(readApi(thisArg.canvas));
      // A negative width/height reads the rectangle to the left/above.
      const [x = 0, y = 0, w = image.width, h = image.height] = args as number[];
      const sx = w < 0 ? x + w : x;
      const sy = h < 0 ? y + h : y;
      noisifyPixels(image.data, image.width, image.height, Math.trunc(sx), Math.trunc(sy), seed);
    } catch {
      /* ignore */
    }
    return image;
  });

  if (offscreenCtxProto) {
    patchMethod(offscreenCtxProto, 'getImageData', (original, thisArg, args) => {
      const image = reflectApply(original, thisArg, args) as ImageData;
      try {
        report(readApi(thisArg.canvas));
        const [sx = 0, sy = 0] = args as number[];
        noisifyPixels(image.data, image.width, image.height, Math.trunc(sx), Math.trunc(sy), seed);
      } catch {
        /* ignore */
      }
      return image;
    });
  }

  if (offscreenProto) {
    patchMethod(offscreenProto, 'convertToBlob', (original, thisArg, args) => {
      try {
        report(readApi(thisArg));
        const { width, height } = thisArg;
        if (width && height) {
          const copy = new (win as any).OffscreenCanvas(width, height);
          const ctx = copy.getContext('2d');
          ctx.drawImage(thisArg, 0, 0);
          const image = reflectApply(getImageData, ctx, [0, 0, width, height]) as ImageData;
          noisifyPixels(image.data, width, height, 0, 0, seed);
          ctx.putImageData(image, 0, 0);
          return reflectApply(original, copy, args);
        }
      } catch {
        /* fall back to the original */
      }
      return reflectApply(original, thisArg, args);
    });
  }
}

/* -------------------------------------------------------------------------- */
/* WebGL                                                                        */
/* -------------------------------------------------------------------------- */

function protectWebGL(win: Win, level: ShieldLevel): void {
  const protos = [win.WebGLRenderingContext?.prototype, (win as any).WebGL2RenderingContext?.prototype].filter(Boolean);
  for (const proto of protos) {
    patchMethod(proto, 'readPixels', (original, thisArg, args) => {
      const result = reflectApply(original, thisArg, args);
      try {
        const [x, y, width, height, , , pixels] = args as [number, number, number, number, number, number, unknown];
        if (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) {
          report('webgl-readpixels');
          noisifyPixels(pixels, width, height, x, y, seed);
        }
      } catch {
        /* ignore */
      }
      return result;
    });

    patchMethod(proto, 'getParameter', (original, thisArg, args) => {
      const pname = args[0];
      if (pname === UNMASKED_VENDOR_WEBGL || pname === UNMASKED_RENDERER_WEBGL) {
        report('webgl-renderer');
        if (level === 'strict') {
          // Report the already-generic masked values instead (e.g. "WebKit").
          return reflectApply(original, thisArg, [pname === UNMASKED_VENDOR_WEBGL ? thisArg.VENDOR : thisArg.RENDERER]);
        }
      }
      return reflectApply(original, thisArg, args);
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Web Audio                                                                    */
/* -------------------------------------------------------------------------- */

function protectAudio(win: Win): void {
  const bufferProto = win.AudioBuffer?.prototype;
  if (bufferProto) {
    patchMethod(bufferProto, 'getChannelData', (original, thisArg, args) => {
      const data = reflectApply(original, thisArg, args) as Float32Array;
      try {
        const channel = Number(args[0]) | 0;
        let done = noisedAudio.get(thisArg);
        if (!done) noisedAudio.set(thisArg, (done = new Set()));
        // getChannelData returns a live view; noise it only once so repeated
        // reads agree.
        if (!done.has(channel)) {
          done.add(channel);
          report('audio');
          noisifySamples(data, channel * 0x100000, seed);
        }
      } catch {
        /* ignore */
      }
      return data;
    });

    patchMethod(bufferProto, 'copyFromChannel', (original, thisArg, args) => {
      const result = reflectApply(original, thisArg, args);
      try {
        const [destination, channel = 0, start = 0] = args as [Float32Array, number, number];
        report('audio');
        noisifySamples(destination, Number(channel) * 0x100000 + Number(start), seed);
      } catch {
        /* ignore */
      }
      return result;
    });
  }

  const analyserProto = win.AnalyserNode?.prototype;
  if (analyserProto) {
    for (const method of ['getFloatFrequencyData', 'getFloatTimeDomainData']) {
      patchMethod(analyserProto, method, (original, thisArg, args) => {
        const result = reflectApply(original, thisArg, args);
        try {
          if (args[0] instanceof Float32Array) {
            report('audio');
            noisifySamples(args[0], 0, seed);
          }
        } catch {
          /* ignore */
        }
        return result;
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Strict-only protections                                                      */
/* -------------------------------------------------------------------------- */

function noisifyRect(rect: DOMRect): DOMRect {
  try {
    rect.x = noisifyMeasurement(rect.x, seed);
    rect.y = noisifyMeasurement(rect.y, seed);
    rect.width = noisifyMeasurement(rect.width, seed);
    rect.height = noisifyMeasurement(rect.height, seed);
  } catch {
    /* DOMRectReadOnly */
  }
  return rect;
}

function protectMeasurements(win: Win): void {
  for (const proto of [win.Element?.prototype, win.Range?.prototype]) {
    patchMethod(proto, 'getBoundingClientRect', (original, thisArg, args) =>
      noisifyRect(reflectApply(original, thisArg, args)),
    );
    patchMethod(proto, 'getClientRects', (original, thisArg, args) => {
      const list = reflectApply(original, thisArg, args) as DOMRectList;
      for (let i = 0; i < list.length; i++) {
        const r = list.item(i);
        if (r) noisifyRect(r);
      }
      return list;
    });
  }

  const metricsProto = win.TextMetrics?.prototype;
  for (const prop of [
    'width',
    'actualBoundingBoxLeft',
    'actualBoundingBoxRight',
    'actualBoundingBoxAscent',
    'actualBoundingBoxDescent',
    'fontBoundingBoxAscent',
    'fontBoundingBoxDescent',
  ]) {
    patchGetter(metricsProto, prop, (original, thisArg) => {
      report('font-metrics');
      return noisifyMeasurement(reflectApply(original, thisArg, []), seed);
    });
  }
}

function protectNavigator(win: Win): void {
  const proto = win.Navigator?.prototype;
  patchGetter(proto, 'hardwareConcurrency', (original, thisArg) =>
    Math.min(4, reflectApply(original, thisArg, []) as number),
  );
  patchGetter(proto, 'deviceMemory', (original, thisArg) => Math.min(8, reflectApply(original, thisArg, []) as number));
}

/* -------------------------------------------------------------------------- */
/* Frames                                                                       */
/* -------------------------------------------------------------------------- */

function protectFrames(win: Win, level: ShieldLevel): void {
  const guard = (w: unknown) => {
    try {
      if (w && !protectedWindows.has(w as object)) protect(w as Win, level);
    } catch {
      /* cross-origin: its own content scripts will handle it */
    }
  };

  for (const ctor of [win.HTMLIFrameElement, win.HTMLFrameElement, win.HTMLObjectElement, win.HTMLEmbedElement]) {
    const proto = ctor?.prototype;
    patchGetter(proto, 'contentWindow', (original, thisArg) => {
      const w = reflectApply(original, thisArg, []);
      guard(w);
      return w;
    });
    patchGetter(proto, 'contentDocument', (original, thisArg) => {
      const d = reflectApply(original, thisArg, []) as Document | null;
      if (d) guard(d.defaultView);
      return d;
    });
  }

  // `frames[0]` and `window[0]` can't be intercepted, so protect frames as
  // soon as they are inserted into the document.
  const protectInserted = (node: unknown) => {
    if (!(node instanceof win.Element) && !(node instanceof win.DocumentFragment)) return;
    const frames: Element[] = [];
    if (node instanceof win.HTMLIFrameElement || node instanceof win.HTMLFrameElement) frames.push(node);
    frames.push(...Array.from((node as ParentNode).querySelectorAll?.('iframe,frame') ?? []));
    for (const frame of frames) guard((frame as HTMLIFrameElement).contentWindow);
  };

  const nodeProto = win.Node?.prototype;
  for (const method of ['appendChild', 'insertBefore', 'replaceChild']) {
    patchMethod(nodeProto, method, (original, thisArg, args) => {
      const result = reflectApply(original, thisArg, args);
      protectInserted(args[0]);
      return result;
    });
  }
  const elementProto = win.Element?.prototype;
  for (const method of ['append', 'prepend', 'after', 'before', 'replaceWith', 'insertAdjacentElement']) {
    patchMethod(elementProto, method, (original, thisArg, args) => {
      const result = reflectApply(original, thisArg, args);
      for (const a of args) protectInserted(a);
      return result;
    });
  }
  patchMethod(elementProto, 'insertAdjacentHTML', (original, thisArg, args) => {
    const result = reflectApply(original, thisArg, args);
    protectInserted(thisArg.parentNode ?? thisArg);
    return result;
  });
  for (const prop of ['innerHTML', 'outerHTML']) {
    const desc = Object.getOwnPropertyDescriptor(elementProto ?? {}, prop);
    if (!desc?.set || !elementProto) continue;
    const originalSet = desc.set;
    Object.defineProperty(elementProto, prop, {
      ...desc,
      set: wrapFunction(originalSet, (target, thisArg, args) => {
        const parent = thisArg.parentNode;
        const result = reflectApply(target, thisArg, args);
        protectInserted(prop === 'innerHTML' ? thisArg : parent);
        return result;
      }),
    });
  }

  for (const method of ['write', 'writeln']) {
    patchMethod(win.Document?.prototype, method, (original, thisArg, args) => {
      const result = reflectApply(original, thisArg, args);
      protectInserted(thisArg.documentElement);
      return result;
    });
  }

  patchMethod(win, 'open', (original, thisArg, args) => {
    const w = reflectApply(original, thisArg, args);
    guard(w);
    return w;
  });
}

/* -------------------------------------------------------------------------- */

/**
 * Browsers also inject this script into same-origin about:blank frames, so a
 * frame we reach through the DOM may already be protected by its own copy.
 * Patching it again would stack two layers of noise. A built-in that is
 * already wrapped in a Proxy stringifies without its name under the pristine
 * toString, which tells us without leaving a marker the page could see.
 */
function alreadyProtected(win: Win): boolean {
  try {
    const fn = win.HTMLCanvasElement?.prototype.toDataURL;
    return typeof fn === 'function' && !reflectApply(nativeToString, fn, []).includes('toDataURL');
  } catch {
    return true;
  }
}

export function protect(win: Win, level: ShieldLevel): void {
  if (protectedWindows.has(win)) return;
  protectedWindows.add(win);
  if (win !== window && alreadyProtected(win)) return;
  maskToString(win);
  protectCanvas(win);
  protectWebGL(win, level);
  protectAudio(win);
  if (level === 'strict') {
    protectMeasurements(win);
    protectNavigator(win);
  }
  protectFrames(win, level);
}

/**
 * Entry point. An about:blank frame whose same-origin parent is already
 * shielded leaves the job to the parent, whose DOM hooks patch it with the
 * parent's seed — so all frames of a page agree. If no hook fires before the
 * current script finishes (e.g. a parser-inserted frame), the microtask below
 * protects the frame itself.
 */
export function start(level: ShieldLevel): void {
  let parentShielded = false;
  try {
    parentShielded =
      window !== window.parent && location.protocol === 'about:' && alreadyProtected(window.parent as Win);
  } catch {
    /* cross-origin parent */
  }
  if (!parentShielded) {
    protect(window, level);
    return;
  }
  queueMicrotask(() => {
    if (!alreadyProtected(window)) protect(window, level);
  });
}
