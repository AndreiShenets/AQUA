import { FilterTypeEnum, IFilter } from './constants';

export type IirCoefficients = [number, number, number, number, number, number];

export const isPassFilterEq = (type: FilterTypeEnum) =>
  type === FilterTypeEnum.BP_EQ ||
  type === FilterTypeEnum.LP_EQ ||
  type === FilterTypeEnum.HP_EQ;

const assertEqType = (type: FilterTypeEnum) => {
  if (!isPassFilterEq(type)) {
    throw new Error(`Not a gain-enabled pass filter: ${type}`);
  }
};

// H_eq(z) = 1 + (10^(gain/20) - 1) H_pass(z). If H_pass = N/D,
// this is the single biquad (D + kN)/D: no virtual channels, channel-count
// assumptions, or changes to the original pass-only filter types are needed.
export const getPassFilterEqCoefficients = (
  filter: IFilter,
  sampleRate: number
): IirCoefficients => {
  assertEqType(filter.type);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Sample rate must be positive and finite');
  }
  if (filter.gain === 0) {
    return [1, 0, 0, 1, 0, 0];
  }

  const frequency = Math.min(filter.frequency, sampleRate * 0.499);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const c = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * filter.quality);
  const k = 10 ** (filter.gain / 20) - 1;
  const denominator = [1 + alpha, -2 * c, 1 - alpha];
  let numerator: number[];

  if (filter.type === FilterTypeEnum.BP_EQ) {
    numerator = [alpha, 0, -alpha];
  } else if (filter.type === FilterTypeEnum.LP_EQ) {
    numerator = [(1 - c) / 2, 1 - c, (1 - c) / 2];
  } else {
    numerator = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  }

  return [
    denominator[0] + k * numerator[0],
    denominator[1] + k * numerator[1],
    denominator[2] + k * numerator[2],
    denominator[0],
    denominator[1],
    denominator[2],
  ];
};

export const getPassFilterEqGain = (
  filter: IFilter,
  frequency: number,
  sampleRate: number
) => {
  const [b0, b1, b2, a0, a1, a2] = getPassFilterEqCoefficients(
    filter,
    sampleRate
  );
  if (filter.gain === 0) {
    return 0;
  }

  // Evaluate the complex response before taking its magnitude. Adding wet and
  // dry magnitudes (or their dB values) would lose phase and misdraw LP/HP EQ.
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const c = Math.cos(omega);
  const c2 = Math.cos(2 * omega);
  const s = Math.sin(omega);
  const s2 = Math.sin(2 * omega);
  const numerator = Math.hypot(b0 + b1 * c + b2 * c2, -b1 * s - b2 * s2);
  const denominator = Math.hypot(a0 + a1 * c + a2 * c2, -a1 * s - a2 * s2);
  return 20 * Math.log10(numerator / denominator);
};

export const passFilterEqToConfig = (filter: IFilter, index: number) => {
  assertEqType(filter.type);
  const comment = `# ${filter.type}: dry + gain-controlled pass filter`;
  if (filter.gain === 0) {
    return `${comment}\n\rFilter${index}: ON IIR Order 2 Coefficients 1 0 0 1 0 0`;
  }

  // Evaluate these at APO's actual device sampleRate, not the graph's 96 kHz.
  // Match the numeric helper's clamp to keep poles stable below Nyquist.
  const prefix = `aquaEq${index}`;
  const omega = `${prefix}w`;
  const c = `${prefix}c`;
  const alpha = `${prefix}a`;
  const k = 10 ** (filter.gain / 20) - 1;
  const denominator = [`1 + ${alpha}`, `-2 * ${c}`, `1 - ${alpha}`];
  let numerator: string[];

  if (filter.type === FilterTypeEnum.BP_EQ) {
    numerator = [alpha, '0', `-${alpha}`];
  } else if (filter.type === FilterTypeEnum.LP_EQ) {
    numerator = [`(1 - ${c}) / 2`, `1 - ${c}`, `(1 - ${c}) / 2`];
  } else {
    numerator = [`(1 + ${c}) / 2`, `-(1 + ${c})`, `(1 + ${c}) / 2`];
  }

  const combined = numerator.map(
    (n, i) => `${denominator[i]} + (${k}) * (${n})`
  );
  const coefficients = [...combined, ...denominator]
    .map((expression) => `\`${expression}\``)
    .join(' ');
  return [
    comment,
    `Eval: ${omega} = 2 * pi * min(${filter.frequency}, sampleRate * 0.499) / sampleRate`,
    `Eval: ${c} = cos(${omega})`,
    `Eval: ${alpha} = sin(${omega}) / (2 * ${filter.quality})`,
    `Filter${index}: ON IIR Order 2 Coefficients ${coefficients}`,
  ].join('\n\r');
};
