import { describe, expect, it } from 'vitest';
import { driftSeconds } from './transportSync';

describe('driftSeconds', () => {
  it('is the plain difference without looping', () => {
    expect(driftSeconds(5.2, 5, 10, false)).toBeCloseTo(0.2);
    expect(driftSeconds(4.5, 5, 10, false)).toBeCloseTo(-0.5);
  });

  it('takes the short way across the loop point', () => {
    // Output at 9.9 s, controller already wrapped to 0.1 s: 0.2 s behind, not 9.8 s ahead.
    expect(driftSeconds(9.9, 0.1, 10, true)).toBeCloseTo(-0.2);
    expect(driftSeconds(0.1, 9.9, 10, true)).toBeCloseTo(0.2);
  });
});
