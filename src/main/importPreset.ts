import fs from 'fs';
import path from 'path';
import {
  FilterTypeEnum,
  IFilter,
  IPresetV2,
  MAX_FREQUENCY,
  MAX_GAIN,
  MAX_NUM_FILTERS,
  MAX_QUALITY,
  MIN_FREQUENCY,
  MIN_GAIN,
  MIN_NUM_FILTERS,
  MIN_QUALITY,
} from '../common/constants';
import {
  MAX_PRESET_IMPORT_BYTES,
  PresetImportResult,
} from '../common/presetImport';
import { serializePreset } from './flush';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

const invalid = (message: string): never => {
  throw new Error(message);
};

const parsePreset = (content: string): IPresetV2 => {
  let input: unknown;
  try {
    input = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    return invalid('Invalid JSON. Drop an AQUA preset file.');
  }
  if (!isObject(input) || !isInRange(input.preAmp, MIN_GAIN, MAX_GAIN)) {
    return invalid(
      `Preamp must be a number between ${MIN_GAIN} and ${MAX_GAIN} dB.`
    );
  }
  if (!Array.isArray(input.filters) && !isObject(input.filters)) {
    return invalid(
      'Missing AQUA filters. Poweramp and APO text files are not supported.'
    );
  }

  const legacy = Array.isArray(input.filters);
  const entries = Object.entries(input.filters);
  if (entries.length < MIN_NUM_FILTERS || entries.length > MAX_NUM_FILTERS) {
    return invalid(
      `A preset must contain ${MIN_NUM_FILTERS} to ${MAX_NUM_FILTERS} filters.`
    );
  }

  const ids = new Set<string>();
  const filters = entries.map(([key, filter], index): [string, IFilter] => {
    if (!isObject(filter)) {
      return invalid(`Filter ${index + 1} is not an AQUA filter.`);
    }
    const { id, type, frequency, gain, quality } = filter;
    if (
      typeof id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
      Object.hasOwn(Object.prototype, id) ||
      ids.has(id) ||
      (!legacy && key !== id)
    ) {
      return invalid(
        `Filter ${index + 1} has an invalid, duplicate, or mismatched ID.`
      );
    }
    if (!Object.values(FilterTypeEnum).includes(type as FilterTypeEnum)) {
      return invalid(`Filter ${index + 1} has an unsupported filter type.`);
    }
    if (
      !isInRange(frequency, MIN_FREQUENCY, MAX_FREQUENCY) ||
      !isInRange(gain, MIN_GAIN, MAX_GAIN) ||
      !isInRange(quality, MIN_QUALITY, MAX_QUALITY)
    ) {
      return invalid(
        `Filter ${index + 1} has frequency, gain, or Q outside AQUA's supported range.`
      );
    }
    ids.add(id);
    return [id, { id, type: type as FilterTypeEnum, frequency, gain, quality }];
  });

  // Canonicalize both legacy arrays and current maps. State files contribute
  // only EQ settings; imported flags/extra properties never alter live state.
  return { preAmp: input.preAmp, filters: Object.fromEntries(filters) };
};

export const importPreset = (
  fileName: unknown,
  content: unknown,
  presetDirectory: string
): PresetImportResult => {
  if (typeof fileName !== 'string' || typeof content !== 'string') {
    return { error: 'Invalid preset import request.' };
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_PRESET_IMPORT_BYTES) {
    return { error: 'Preset files must be no larger than 256 KiB.' };
  }

  const presetName = fileName.replace(/\.json$/i, '');
  if (
    !presetName ||
    presetName.length > 120 ||
    presetName.trim() !== presetName ||
    /[<>:"/\\|?*]/.test(presetName) ||
    Array.from(presetName).some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(presetName) ||
    /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(presetName)
  ) {
    return { error: 'Invalid preset filename. Rename the file and try again.' };
  }

  let preset: IPresetV2;
  try {
    preset = parsePreset(content);
  } catch (error) {
    return { error: (error as Error).message };
  }

  try {
    // Reject case-only duplicates too, even on case-sensitive Windows folders.
    // Exclusive creation also protects against races and existing symlinks.
    if (
      fs
        .readdirSync(presetDirectory)
        .some((name) => name.toLowerCase() === presetName.toLowerCase())
    ) {
      return {
        error:
          'A preset with this name already exists. Rename the file to import a separate copy.',
      };
    }
    const destination = path.join(presetDirectory, presetName);
    const fd = fs.openSync(destination, 'wx');
    try {
      fs.writeFileSync(fd, serializePreset(preset));
    } catch (error) {
      fs.closeSync(fd);
      fs.unlinkSync(destination);
      throw error;
    }
    fs.closeSync(fd);
    return { presetName };
  } catch (error) {
    return {
      error:
        (error as NodeJS.ErrnoException).code === 'EEXIST'
          ? 'A preset with this name already exists. Rename the file to import a separate copy.'
          : 'Could not save the preset. Check folder permissions and available disk space.',
    };
  }
};
