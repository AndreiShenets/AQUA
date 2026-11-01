import '@testing-library/jest-dom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { FilterTypeEnum, getDefaultFilterWithId } from 'common/constants';
import {
  MAX_PRESET_IMPORT_BYTES,
  PresetImportResult,
} from 'common/presetImport';
import { fetchPreset } from 'main/flush';
import { importPreset as persistImport } from 'main/importPreset';
import PresetsBar from 'renderer/PresetsBar';
import PresetImport from 'renderer/components/PresetImport';
import { AquaProviderWrapper } from 'renderer/utils/AquaContext';
import defaultAquaContext from '../utils/mockAquaProvider';
import { setup } from '../utils/userEventUtils';

const filter = {
  ...getDefaultFilterWithId(),
  type: FilterTypeEnum.BP_EQ,
  gain: 6,
};
const preset = { preAmp: -6, filters: { [filter.id]: filter } };
const content = JSON.stringify(preset);
let directory: string;
let importPreset: jest.Mock;
const loadPreset = jest.fn();
const savePreset = jest.fn();
const fetchPresets = jest.fn(async () => ['Existing']);
const renamePreset = jest.fn();
const deletePreset = jest.fn();

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-drop-'));
  fs.writeFileSync(path.join(directory, 'Existing'), 'do not overwrite');
  importPreset = jest.fn(async (name: string, text: string) =>
    persistImport(name, text, directory)
  );
  loadPreset.mockClear();
  savePreset.mockClear();
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

const renderMenu = () =>
  setup(
    <AquaProviderWrapper value={defaultAquaContext}>
      <PresetsBar
        fetchPresets={fetchPresets}
        loadPreset={loadPreset}
        savePreset={savePreset}
        renamePreset={renamePreset}
        deletePreset={deletePreset}
        importPreset={importPreset}
      />
    </AquaProviderWrapper>
  );
const drop = (files: File[]) =>
  fireEvent.drop(screen.getByRole('region', { name: 'Preset import' }), {
    dataTransfer: { files, types: ['Files'] },
  });

it('imports a dropped file through actual validation/persistence and refreshes the menu without loading it', async () => {
  const { user } = renderMenu();
  await user.click(await screen.findByLabelText('Existing'));

  expect(drop([new File([content], 'Imported.json')])).toBe(false);
  await screen.findByText('Imported as “Imported”.');

  expect(await screen.findByLabelText('Imported')).toBeInTheDocument();
  expect(fetchPreset('Imported', directory)).toEqual(preset);
  expect(screen.getByLabelText('Preset Name')).toHaveValue('Existing');
  expect(loadPreset).not.toHaveBeenCalled();
  expect(savePreset).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(directory, 'Existing'), 'utf8')).toBe(
    'do not overwrite'
  );
});

it('imports valid files from a mixed batch and explains each rejection', async () => {
  renderMenu();
  drop([
    new File(['broken JSON'], 'Broken.json'),
    new File([content], 'Good'),
    new File([content], 'Existing.json'),
    new File([content], 'Other.json'),
  ]);

  await screen.findByText('Imported as “Other”.');
  expect(
    screen.getByText('Invalid JSON. Drop an AQUA preset file.')
  ).toBeInTheDocument();
  expect(
    screen.getByText(/A preset with this name already exists/)
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Good')).toBeInTheDocument();
  expect(screen.queryByLabelText('Broken')).not.toBeInTheDocument();
  expect(fs.readdirSync(directory).sort()).toEqual([
    'Existing',
    'Good',
    'Other',
  ]);
});

it('offers a keyboard-accessible file picker for the same import', async () => {
  const { user } = renderMenu();
  const picker = screen.getByLabelText('Import AQUA preset files');

  await user.upload(
    picker,
    new File([content], 'Chosen.json', { type: 'application/json' })
  );

  await screen.findByLabelText('Chosen');
  expect(fetchPreset('Chosen', directory)).toEqual(preset);
  expect(picker).toHaveValue('');
});

it('rejects oversized files without reading/sending them and continues the batch', async () => {
  renderMenu();
  drop([
    new File(['x'.repeat(MAX_PRESET_IMPORT_BYTES + 1)], 'Huge.json'),
    new File([content], 'Small.json'),
  ]);

  await screen.findByLabelText('Small');
  expect(
    screen.getByText('Preset files must be no larger than 256 KiB.')
  ).toBeInTheDocument();
  expect(importPreset).toHaveBeenCalledTimes(1);
  expect(importPreset).toHaveBeenCalledWith('Small.json', content);
});

it('rejects batches larger than 20 without importing any files', async () => {
  renderMenu();
  drop(
    Array.from(
      { length: 21 },
      (_, index) => new File([content], `${index}.json`)
    )
  );

  expect(
    await screen.findByText('Drop at most 20 files at a time.')
  ).toBeInTheDocument();
  expect(importPreset).not.toHaveBeenCalled();
});

it('does not start a second import while the first is pending', async () => {
  let complete!: (result: PresetImportResult) => void;
  importPreset.mockImplementationOnce(
    () =>
      new Promise<PresetImportResult>((resolve) => {
        complete = resolve;
      })
  );
  renderMenu();
  drop([new File([content], 'First.json')]);
  await waitFor(() => expect(importPreset).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Import AQUA preset files')).toBeDisabled();
  drop([new File([content], 'Second.json')]);
  complete({ presetName: 'First' });

  await screen.findByLabelText('First');
  expect(importPreset).toHaveBeenCalledTimes(1);
});

it('shows a recoverable error if IPC fails, instead of disabling the application', async () => {
  importPreset.mockRejectedValueOnce(new Error('IPC timeout'));
  renderMenu();
  drop([new File([content], 'Failed.json')]);

  await screen.findByText(
    'Could not read or import the file. Please try again.'
  );
  expect(screen.getByLabelText('Import AQUA preset files')).toBeEnabled();
  drop([new File([content], 'Retry.json')]);
  await screen.findByLabelText('Retry');
});

it('prevents accidental file navigation outside the drop target', () => {
  renderMenu();

  expect(
    fireEvent.drop(document.body, { dataTransfer: { types: ['Files'] } })
  ).toBe(false);
});

it('disables both drop and file picking when requested', () => {
  setup(
    <PresetImport
      importPreset={importPreset}
      onImported={jest.fn()}
      isDisabled
    />
  );
  drop([new File([content], 'Disabled.json')]);

  expect(screen.getByLabelText('Import AQUA preset files')).toBeDisabled();
  expect(importPreset).not.toHaveBeenCalled();
});
