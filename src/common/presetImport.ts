export const MAX_PRESET_IMPORT_BYTES = 256 * 1024;
export const MAX_PRESET_IMPORT_FILES = 20;

export type PresetImportResult =
  { presetName: string; error?: never } | { error: string; presetName?: never };
