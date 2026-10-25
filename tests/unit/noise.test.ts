import { describe, expect, it } from 'vitest';
import { mix32, noisifyMeasurement, noisifyPixels, noisifySamples } from '../../src/content/fingerprint/noise';

function solid(width: number, height: number, alpha = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 120;
    data[i + 1] = 60;
    data[i + 2] = 30;
    data[i + 3] = alpha;
  }
  return data;
}

describe('noisifyPixels', () => {
  it('changes a small fraction of pixels by at most one level', () => {
    const data = solid(100, 100);
    const changed = noisifyPixels(data, 100, 100, 0, 0, 1234);
    expect(changed).toBeGreaterThan(300); // ~1/16 of 10 000
    expect(changed).toBeLessThan(1000);
    for (let i = 0; i < data.length; i += 4) {
      expect(Math.abs(data[i]! - 120) + Math.abs(data[i + 1]! - 60) + Math.abs(data[i + 2]! - 30)).toBeLessThanOrEqual(
        1,
      );
      expect(data[i + 3]).toBe(255);
    }
  });

  it('is deterministic for a seed and different across seeds', () => {
    const a = solid(50, 50);
    const b = solid(50, 50);
    const c = solid(50, 50);
    noisifyPixels(a, 50, 50, 0, 0, 7);
    noisifyPixels(b, 50, 50, 0, 0, 7);
    noisifyPixels(c, 50, 50, 0, 0, 8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('agrees between a full read and a sub-rectangle read', () => {
    const full = solid(40, 40);
    noisifyPixels(full, 40, 40, 0, 0, 99);
    const part = solid(10, 10);
    noisifyPixels(part, 10, 10, 20, 15, 99);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const i = (y * 10 + x) * 4;
        const j = ((y + 15) * 40 + (x + 20)) * 4;
        expect([...part.slice(i, i + 4)]).toEqual([...full.slice(j, j + 4)]);
      }
    }
  });

  it('leaves transparent pixels alone, so blank canvases stay blank', () => {
    const data = solid(20, 20, 0);
    expect(noisifyPixels(data, 20, 20, 0, 0, 5)).toBe(0);
  });

  it('never overflows the 0–255 range', () => {
    const data = new Uint8ClampedArray(64 * 64 * 4).fill(255);
    noisifyPixels(data, 64, 64, 0, 0, 3);
    expect(Math.min(...data)).toBeGreaterThanOrEqual(254);
  });
});

describe('noisifySamples', () => {
  it('perturbs a few samples by a tiny relative amount', () => {
    const data = new Float32Array(4096).fill(0.5);
    noisifySamples(data, 0, 42);
    const changed = data.filter((v) => v !== 0.5);
    expect(changed.length).toBeGreaterThan(20);
    expect(changed.length).toBeLessThan(200);
    for (const v of changed) expect(Math.abs(v - 0.5)).toBeLessThan(1e-4);
  });
});

describe('noisifyMeasurement', () => {
  it('is stable for equal inputs and small', () => {
    expect(noisifyMeasurement(123.456, 1)).toBe(noisifyMeasurement(123.456, 1));
    expect(Math.abs(noisifyMeasurement(123.456, 1) - 123.456)).toBeLessThan(0.003);
    expect(noisifyMeasurement(0, 1)).toBe(0);
  });
});

describe('mix32', () => {
  it('produces well-spread unsigned integers', () => {
    const seen = new Set(Array.from({ length: 1000 }, (_, i) => mix32(i)));
    expect(seen.size).toBe(1000);
    for (const v of seen) expect(v).toBeGreaterThanOrEqual(0);
  });
});
