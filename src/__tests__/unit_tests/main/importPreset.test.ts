import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FilterTypeEnum,
  getDefaultFilterWithId,
  getDefaultState,
} from 'common/constants';
import { MAX_PRESET_IMPORT_BYTES } from 'common/presetImport';
import { fetchPreset, stateToString } from 'main/flush';
import { importPreset } from 'main/importPreset';

const filter = {
  ...getDefaultFilterWithId(),
  id: 'band1',
  type: FilterTypeEnum.BP_EQ,
  gain: 6,
};
const preset = { preAmp: -6, filters: { [filter.id]: filter } };
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-import-'));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

it.each(['My EQ.json', 'My EQ.JSON', 'My EQ'])(
  'imports %s to an extensionless file readable by the actual preset loader',
  (fileName) => {
    expect(importPreset(fileName, JSON.stringify(preset), directory)).toEqual({
      presetName: 'My EQ',
    });
    expect(fs.readdirSync(directory)).toEqual(['My EQ']);
    expect(fetchPreset('My EQ', directory)).toEqual(preset);
    expect(
      stateToString({
        ...getDefaultState(),
        ...fetchPreset('My EQ', directory),
      })
    ).toContain('ON IIR Order 2');
  }
);

it('normalizes legacy array presets without changing values or order', () => {
  const second = {
    ...filter,
    id: 'band2',
    type: FilterTypeEnum.HPQ,
    frequency: 30,
  };
  const legacy = { preAmp: 0.00478363037109375, filters: [filter, second] };

  expect(
    importPreset('Legacy.json', JSON.stringify(legacy), directory)
  ).toEqual({ presetName: 'Legacy' });
  expect(fetchPreset('Legacy', directory)).toEqual({
    preAmp: legacy.preAmp,
    filters: { band1: filter, band2: second },
  });
});

it('accepts BOM-prefixed state JSON but only stores canonical EQ settings', () => {
  const state = {
    ...getDefaultState(),
    ...preset,
    extra: { unexpected: true },
  };

  expect(
    importPreset('State.json', `\uFEFF${JSON.stringify(state)}`, directory)
  ).toEqual({ presetName: 'State' });
  expect(fetchPreset('State', directory)).toEqual(preset);
});

it.each(Object.values(FilterTypeEnum))(
  'accepts supported filter type %s',
  (type) => {
    const input = { ...preset, filters: { band1: { ...filter, type } } };

    expect(importPreset('Supported', JSON.stringify(input), directory)).toEqual(
      { presetName: 'Supported' }
    );
  }
);

it.each([
  '',
  '{broken',
  'null',
  '[]',
  '{}',
  JSON.stringify([{ name: 'Poweramp', preamp: 0, bands: [] }]),
  'Preamp: -6 dB\nFilter: ON PK Fc 1000 Hz Gain 6 dB Q 1',
  JSON.stringify({ ...preset, preAmp: '0' }),
  JSON.stringify({ ...preset, preAmp: 31 }),
  JSON.stringify({ ...preset, preAmp: -31 }),
  JSON.stringify({ ...preset, filters: {} }),
  JSON.stringify({ ...preset, filters: [] }),
  JSON.stringify({ ...preset, filters: null }),
  '{"preAmp":1e400,"filters":{}}',
])('rejects invalid preset content without writing: %s', (content) => {
  expect(importPreset('Invalid.json', content, directory)).toHaveProperty(
    'error'
  );
  expect(fs.readdirSync(directory)).toEqual([]);
});

it.each([
  { frequency: 0 },
  { frequency: 20001 },
  { frequency: '1000' },
  { gain: -31 },
  { gain: 31 },
  { gain: null },
  { quality: 0 },
  { quality: 101 },
  { quality: '1' },
  { type: 'UNSUPPORTED' },
  { id: '' },
  { id: 'other' },
  { id: '__proto__' },
])('rejects invalid filter fields: %o', (changes) => {
  const input = { ...preset, filters: { band1: { ...filter, ...changes } } };

  expect(
    importPreset('Invalid', JSON.stringify(input), directory)
  ).toHaveProperty('error');
  expect(fs.readdirSync(directory)).toEqual([]);
});

it('rejects duplicate legacy IDs and unsafe prototype IDs', () => {
  const inputs = [
    { preAmp: 0, filters: [filter, filter] },
    { preAmp: 0, filters: [{ ...filter, id: '__proto__' }] },
    { preAmp: 0, filters: [{ ...filter, id: 'constructor' }] },
  ];
  inputs.forEach((input) =>
    expect(
      importPreset('Invalid', JSON.stringify(input), directory)
    ).toHaveProperty('error')
  );
  expect(fs.readdirSync(directory)).toEqual([]);
});

it('rejects more filters than AQUA supports', () => {
  const filters = Array.from({ length: 21 }, (_, index) => ({
    ...filter,
    id: `band${index}`,
  }));

  expect(
    importPreset('Too many', JSON.stringify({ preAmp: 0, filters }), directory)
  ).toHaveProperty('error');
  expect(fs.readdirSync(directory)).toEqual([]);
});

it.each([
  '../escape.json',
  '..\\escape.json',
  'C:\\escape.json',
  'CON.json',
  'CON.txt.json',
  'LPT1',
  'COM¹.json',
  'a:b.json',
  '.json',
  '.',
  'trailing.',
  ' leading.json',
  'a\u0000b',
  'x'.repeat(121),
])('rejects unsafe filename %s without writing', (fileName) => {
  expect(
    importPreset(fileName, JSON.stringify(preset), directory)
  ).toHaveProperty('error');
  expect(fs.readdirSync(directory)).toEqual([]);
});

it('checks UTF-8 byte limits in main, not just string length in the renderer', () => {
  const content = '€'.repeat(Math.floor(MAX_PRESET_IMPORT_BYTES / 3) + 1);

  expect(importPreset('Large', content, directory)).toEqual({
    error: 'Preset files must be no larger than 256 KiB.',
  });
  expect(fs.readdirSync(directory)).toEqual([]);
});

it.each([
  [null, '{}'],
  ['Preset', {}],
  [undefined, undefined],
])('rejects malformed IPC input', (name, content) => {
  expect(importPreset(name, content, directory)).toHaveProperty('error');
  expect(fs.readdirSync(directory)).toEqual([]);
});

it.each(['Existing', 'existing.JSON'])(
  'never overwrites existing or case-only matching names: %s',
  (name) => {
    fs.writeFileSync(path.join(directory, 'Existing'), 'original contents');

    expect(
      importPreset(name, JSON.stringify(preset), directory)
    ).toHaveProperty('error');
    expect(fs.readFileSync(path.join(directory, 'Existing'), 'utf8')).toBe(
      'original contents'
    );
  }
);

it('uses exclusive creation even if the directory listing misses a collision', () => {
  fs.writeFileSync(path.join(directory, 'Existing'), 'original contents');
  jest.spyOn(fs, 'readdirSync').mockReturnValueOnce([]);

  expect(
    importPreset('Existing', JSON.stringify(preset), directory)
  ).toHaveProperty('error');
  expect(fs.readFileSync(path.join(directory, 'Existing'), 'utf8')).toBe(
    'original contents'
  );
});

it('removes its incomplete file if writing fails', () => {
  jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
    throw new Error('Disk full');
  });

  expect(
    importPreset('Incomplete', JSON.stringify(preset), directory)
  ).toHaveProperty('error');
  expect(fs.readdirSync(directory)).toEqual([]);
});

it('reports filesystem failures without throwing', () => {
  expect(
    importPreset(
      'Preset',
      JSON.stringify(preset),
      path.join(directory, 'missing')
    )
  ).toHaveProperty('error');
});
