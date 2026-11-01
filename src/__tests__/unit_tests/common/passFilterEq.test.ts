import { FilterTypeEnum, getDefaultFilterWithId } from 'common/constants';
import {
  getPassFilterEqCoefficients,
  getPassFilterEqGain,
  isPassFilterEq,
  passFilterEqToConfig,
} from 'common/passFilterEq';

const types = [
  FilterTypeEnum.BP_EQ,
  FilterTypeEnum.LP_EQ,
  FilterTypeEnum.HP_EQ,
];
const filter = {
  ...getDefaultFilterWithId(),
  frequency: 1000,
  quality: 0.707,
  gain: 6,
};
const rates = [44100, 48000, 96000];

const response = (
  coefficients: number[],
  frequency: number,
  sampleRate: number
) => {
  const [b0, b1, b2, a0, a1, a2] = coefficients;
  const w = (2 * Math.PI * frequency) / sampleRate;
  const numerator = {
    re: b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w),
    im: -b1 * Math.sin(w) - b2 * Math.sin(2 * w),
  };
  const denominator = {
    re: a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w),
    im: -a1 * Math.sin(w) - a2 * Math.sin(2 * w),
  };
  const squared = denominator.re ** 2 + denominator.im ** 2;
  return {
    re:
      (numerator.re * denominator.re + numerator.im * denominator.im) / squared,
    im:
      (numerator.im * denominator.re - numerator.re * denominator.im) / squared,
  };
};

// Test-only interpreter for the trusted Eval/inline expressions we emit. This
// checks the exported APO configuration, not just the graph's numeric helper.
const evaluateConfig = (config: string, sampleRate: number) => {
  const variables: Record<string, number> = { sampleRate, pi: Math.PI };
  const evaluate = (expression: string): number => {
    const names = Object.keys(variables);
    return new Function(
      ...names,
      'sin',
      'cos',
      'min',
      `return (${expression.replaceAll('^', '**')});`
    )(...Object.values(variables), Math.sin, Math.cos, Math.min);
  };

  let coefficients: number[] = [];
  config.split(/\r\n|\n\r|\r|\n/).forEach((line) => {
    if (line.startsWith('Eval: ')) {
      const [, name, expression] = line.match(/^Eval: (\w+) = (.+)$/)!;
      variables[name] = evaluate(expression);
    } else if (line.includes('Coefficients ')) {
      const values = line.split('Coefficients ')[1];
      coefficients = [...values.matchAll(/`([^`]+)`|([^\s]+)/g)].map((match) =>
        evaluate(match[1] || match[2])
      );
    }
  });
  return coefficients;
};

describe.each(types)('%s dry-plus-filtered equalization', (type) => {
  it.each(rates)('is exactly flat at zero gain at %i Hz', (sampleRate) => {
    const zero = { ...filter, type, gain: 0 };

    expect(getPassFilterEqCoefficients(zero, sampleRate)).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
    expect(evaluateConfig(passFilterEqToConfig(zero, 0), sampleRate)).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
    [20, 1000, 20000].forEach((frequency) =>
      expect(getPassFilterEqGain(zero, frequency, sampleRate)).toBe(0)
    );
  });

  it.each([-12, -6, 6, 12])('has the requested %i dB band gain', (gain) => {
    const frequency =
      type === FilterTypeEnum.BP_EQ
        ? filter.frequency
        : type === FilterTypeEnum.LP_EQ
          ? 0
          : 24000;

    expect(
      getPassFilterEqGain({ ...filter, type, gain }, frequency, 48000)
    ).toBeCloseTo(gain, 7);
  });

  it('leaves the opposite end of the spectrum unchanged', () => {
    const frequencies =
      type === FilterTypeEnum.BP_EQ
        ? [0, 24000]
        : [type === FilterTypeEnum.LP_EQ ? 24000 : 0];

    frequencies.forEach((frequency) =>
      expect(
        getPassFilterEqGain({ ...filter, type }, frequency, 48000)
      ).toBeCloseTo(0, 7)
    );
  });

  it.each(rates)(
    'matches the exported sample-rate-aware IIR at %i Hz',
    (sampleRate) => {
      const eq = { ...filter, type, gain: -6, quality: 3.5 };
      const numeric = getPassFilterEqCoefficients(eq, sampleRate);
      const exported = evaluateConfig(passFilterEqToConfig(eq, 7), sampleRate);

      expect(exported).toHaveLength(6);
      exported.forEach((value, index) =>
        expect(value).toBeCloseTo(numeric[index], 12)
      );
      [20, 100, 1000, 5000, 20000].forEach((frequency) => {
        const actual = response(exported, frequency, sampleRate);
        const db = 20 * Math.log10(Math.hypot(actual.re, actual.im));
        expect(db).toBeCloseTo(
          getPassFilterEqGain(eq, frequency, sampleRate),
          7
        );
      });
    }
  );

  it('equals a phase-aware parallel sum rather than a sum of magnitudes', () => {
    const sampleRate = 48000;
    const w = (2 * Math.PI * filter.frequency) / sampleRate;
    const alpha = Math.sin(w) / (2 * filter.quality);
    const c = Math.cos(w);
    const numerator =
      type === FilterTypeEnum.BP_EQ
        ? [alpha, 0, -alpha]
        : type === FilterTypeEnum.LP_EQ
          ? [(1 - c) / 2, 1 - c, (1 - c) / 2]
          : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    const base = [...numerator, 1 + alpha, -2 * c, 1 - alpha];
    const k = 10 ** (filter.gain / 20) - 1;
    const combined = getPassFilterEqCoefficients(
      { ...filter, type },
      sampleRate
    );

    [50, 500, 1000, 2000, 10000].forEach((frequency) => {
      const wet = response(base, frequency, sampleRate);
      const actual = response(combined, frequency, sampleRate);
      expect(actual.re).toBeCloseTo(1 + k * wet.re, 8);
      expect(actual.im).toBeCloseTo(k * wet.im, 8);
    });
  });

  it('clamps the design frequency below Nyquist on low-rate devices', () => {
    const highFrequency = { ...filter, type, frequency: 20000 };
    const sampleRate = 16000;
    const coefficients = getPassFilterEqCoefficients(highFrequency, sampleRate);
    const exported = evaluateConfig(
      passFilterEqToConfig(highFrequency, 0),
      sampleRate
    );

    expect(coefficients.every(Number.isFinite)).toBe(true);
    exported.forEach((value, index) =>
      expect(value).toBeCloseTo(coefficients[index], 12)
    );
    expect(coefficients[3]).toBeGreaterThan(1);
  });

  it('stays stable and finite across the supported frequency, gain and Q ranges', () => {
    [8000, 44100, 48000, 96000, 192000].forEach((sampleRate) => {
      [1, 1000, 20000].forEach((frequency) => {
        [0.01, 1, 100].forEach((quality) => {
          [-30, 0, 30].forEach((gain) => {
            const eq = { ...filter, type, frequency, quality, gain };
            const [, , , a0, a1, a2] = getPassFilterEqCoefficients(
              eq,
              sampleRate
            );

            expect(a0 - a2).toBeGreaterThan(0);
            expect(a0 + a1 + a2).toBeGreaterThan(0);
            expect(a0 - a1 + a2).toBeGreaterThan(0);
            [10, 1000, sampleRate * 0.49].forEach((probe) => {
              expect(
                Number.isFinite(getPassFilterEqGain(eq, probe, sampleRate))
              ).toBe(true);
            });
          });
        });
      });
    });
  });
});

it('recognizes only the new gain-enabled types', () => {
  Object.values(FilterTypeEnum).forEach((type) => {
    expect(isPassFilterEq(type)).toBe(types.includes(type));
  });
});
