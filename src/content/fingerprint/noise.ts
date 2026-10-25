/**
 * Deterministic noise.
 *
 * Fingerprinting scripts render something (text, a WebGL scene, an audio
 * graph) and hash the output, which differs subtly between GPUs, drivers,
 * fonts and OSes. We perturb a small fraction of the output with noise derived
 * from a secret per-page seed and the *position* of each sample, so:
 *
 *  - reading the same canvas twice gives the same result (scripts that read
 *    twice to detect random noise learn nothing),
 *  - reading a sub-rectangle agrees with reading the whole canvas,
 *  - the hash changes on every page load, so it can't link visits.
 *
 * The changes are ±1 on one colour channel of ~6% of non-transparent pixels:
 * invisible to people, fatal to a hash.
 */

/** MurmurHash3's 32-bit finalizer: a fast, well-distributed integer mix. */
export function mix32(value: number): number {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function positionHash(seed: number, x: number, y: number): number {
  return mix32(seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca77));
}

/**
 * Perturbs RGBA pixel data in place. `originX/Y` are the coordinates of the
 * first pixel in the source surface, so sub-rectangle reads stay consistent.
 */
export function noisifyPixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  seed: number,
): number {
  let changed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (i + 3 >= data.length) return changed;
      if (data[i + 3] === 0) continue; // keep transparent pixels transparent
      const h = positionHash(seed, originX + x, originY + y);
      if ((h & 0xf) !== 0) continue; // ~1 in 16 pixels
      const channel = i + ((h >>> 4) % 3);
      const current = data[channel] ?? 0;
      const delta = h & 0x100 ? 1 : -1;
      let next = current + delta;
      if (next < 0 || next > 255) next = current - delta;
      data[channel] = next;
      changed++;
    }
  }
  return changed;
}

/** Perturbs ~1/64 audio samples by a tiny relative amount. */
export function noisifySamples(data: Float32Array, offset: number, seed: number): void {
  for (let i = 0; i < data.length; i++) {
    const h = positionHash(seed, offset + i, 0x5eed);
    if ((h & 0x3f) !== 0) continue;
    const v = data[i] ?? 0;
    const magnitude = Math.max(Math.abs(v) * 1e-5, 1e-7);
    data[i] = v + (h & 0x40 ? magnitude : -magnitude);
  }
}

/**
 * Noise for a measurement (a DOMRect edge, a text width). It depends on the
 * value itself, so equal inputs stay equal and repeated reads agree.
 */
export function noisifyMeasurement(value: number, seed: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const h = mix32(seed ^ Math.round(value * 256));
  return value + ((h & 0xffff) / 0xffff - 0.5) * 0.004;
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 0x2545f491;
}
