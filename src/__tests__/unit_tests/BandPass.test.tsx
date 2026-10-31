import '@testing-library/jest-dom';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { screen } from '@testing-library/react';
import {
  FilterTypeEnum,
  getDefaultFilterWithId,
  getDefaultState,
} from 'common/constants';
import {
  validatePresetV1,
  validatePresetV2,
  validateState,
} from 'common/validator';
import {
  fetchPreset,
  fetchSettings,
  save,
  savePreset,
  stateToString,
} from 'main/flush';
import { getFilterLineData } from 'renderer/graph/utils';
import Dropdown from 'renderer/widgets/Dropdown';
import { FILTER_OPTIONS } from 'renderer/icons/FilterTypeIcon';
import { setup } from '../utils/userEventUtils';

describe('band-pass filter', () => {
  const filter = {
    ...getDefaultFilterWithId(),
    type: FilterTypeEnum.BP,
    frequency: 1000,
    quality: 2,
    gain: 12,
  };
  const state = { ...getDefaultState(), filters: { [filter.id]: filter } };

  it('can be selected from the filter dropdown', async () => {
    const handleChange = jest.fn();
    const { user } = setup(
      <Dropdown
        name="filter-type"
        options={FILTER_OPTIONS}
        value={FilterTypeEnum.PK}
        isDisabled={false}
        handleChange={handleChange}
      />
    );

    await user.click(screen.getByLabelText('filter-type'));
    await user.click(screen.getByLabelText('Band Pass Filter'));

    expect(handleChange).toHaveBeenCalledWith(FilterTypeEnum.BP);
  });

  it.each(Object.values(FilterTypeEnum))(
    'accepts %s in state and both preset formats',
    (type) => {
      const typedFilter = { ...filter, type };
      const filters = { [filter.id]: typedFilter };

      expect(validateState({ ...state, filters })).toBe(true);
      expect(validatePresetV1({ preAmp: 0, filters: [typedFilter] })).toBe(
        true
      );
      expect(validatePresetV2({ preAmp: 0, filters })).toBe(true);
    }
  );

  it('rejects unknown filter types', () => {
    const invalidFilter = { ...filter, type: 'INVALID' };
    const filters = { [filter.id]: invalidFilter };

    expect(validateState({ ...state, filters })).toBe(false);
    expect(validatePresetV1({ preAmp: 0, filters: [invalidFilter] })).toBe(
      false
    );
    expect(validatePresetV2({ preAmp: 0, filters })).toBe(false);
  });

  it('survives saving and reloading settings and presets', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-bp-'));
    const preset = { preAmp: state.preAmp, filters: state.filters };

    try {
      save(state, directory);
      savePreset('Band pass', preset, directory);

      expect(fetchSettings(directory)).toEqual(state);
      expect(fetchPreset('Band pass', directory)).toEqual(preset);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes BP frequency and quality without an unsupported gain parameter', () => {
    expect(stateToString(state)).toContain('ON BP Fc 1000 Hz Q 2');
    expect(stateToString(state)).not.toContain('Gain');
  });

  it('passes the center frequency, attenuates both sides, and ignores gain', () => {
    const points = getFilterLineData(filter);
    const closest = (frequency: number) =>
      points.reduce((a, b) =>
        Math.abs(a.x - frequency) < Math.abs(b.x - frequency) ? a : b
      );

    expect(closest(1000).y).toBeCloseTo(0, 1);
    expect(closest(100).y).toBeLessThan(-20);
    expect(closest(10000).y).toBeLessThan(-20);
    expect(getFilterLineData({ ...filter, gain: -12 })).toEqual(points);
  });
});
