import '@testing-library/jest-dom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { screen } from '@testing-library/react';
import {
  FilterTypeEnum,
  FilterTypeToLabelMap,
  getDefaultFilterWithId,
  getDefaultState,
} from 'common/constants';
import { getPassFilterEqGain } from 'common/passFilterEq';
import {
  fetchPreset,
  fetchSettings,
  save,
  savePreset,
  stateToString,
} from 'main/flush';
import FrequencyBand from 'renderer/components/FrequencyBand';
import { FILTER_OPTIONS } from 'renderer/icons/FilterTypeIcon';
import { getCombinedLineData, getFilterLineData } from 'renderer/graph/utils';
import { AquaProviderWrapper } from 'renderer/utils/AquaContext';
import Dropdown from 'renderer/widgets/Dropdown';
import defaultAquaContext from '../utils/mockAquaProvider';
import { setup } from '../utils/userEventUtils';

const types = [
  FilterTypeEnum.BP_EQ,
  FilterTypeEnum.LP_EQ,
  FilterTypeEnum.HP_EQ,
];

describe.each(types)('%s integration', (type) => {
  const filter = {
    ...getDefaultFilterWithId(),
    type,
    frequency: 1000,
    quality: 2,
    gain: -6,
  };

  it('is distinct from the pass-only filters and selectable from the dropdown', async () => {
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
    await user.click(screen.getByLabelText(FilterTypeToLabelMap[type]));

    expect(handleChange).toHaveBeenCalledWith(type);
  });

  it('enables gain and retains frequency and Q controls', () => {
    setup(
      <AquaProviderWrapper value={defaultAquaContext}>
        <FrequencyBand filter={filter} isMinSliderCount={false} />
      </AquaProviderWrapper>
    );

    expect(screen.getByLabelText('1000-gain-number')).toBeEnabled();
    expect(screen.getByLabelText('1000-gain-range')).toBeEnabled();
    expect(screen.getByLabelText('1000-frequency')).toBeEnabled();
    expect(screen.getByLabelText('1000-quality')).toBeEnabled();
    expect(screen.getByTitle(FilterTypeToLabelMap[type])).toBeInTheDocument();
  });

  it('round-trips its type, gain, frequency and Q in state and presets', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-pass-eq-'));
    const state = { ...getDefaultState(), filters: { [filter.id]: filter } };
    const preset = { preAmp: 0, filters: state.filters };

    try {
      save(state, directory);
      savePreset('Pass EQ', preset, directory);

      expect(fetchSettings(directory)).toEqual(state);
      expect(fetchPreset('Pass EQ', directory)).toEqual(preset);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('exports an IIR stage, not an unsupported native APO filter name', () => {
    const state = { ...getDefaultState(), filters: { [filter.id]: filter } };
    const config = stateToString(state);

    expect(config).toContain(`# ${type}:`);
    expect(config).toContain('Filter0: ON IIR Order 2 Coefficients');
    expect(config).toContain('sampleRate');
    expect(config).not.toContain(`ON ${type}`);
    expect(config).not.toContain('Copy:');
    expect(config.match(/Channel: all/g)).toHaveLength(1);
  });

  it('draws the same phase-aware response as the exported EQ stage', () => {
    const line = getFilterLineData(filter);

    line.forEach(({ x, y }) => {
      expect(y).toBe(getPassFilterEqGain(filter, x, 96000));
      expect(Number.isFinite(y)).toBe(true);
    });
    expect(
      getFilterLineData({ ...filter, gain: 0 }).every(({ y }) => y === 0)
    ).toBe(true);
  });
});

it('cascades multiple EQ stages and keeps separate exported variables', () => {
  const filters = types.map((type, index) => ({
    ...getDefaultFilterWithId(),
    id: `eq${index}`,
    type,
    frequency: 1000 + index * 1000,
    gain: index === 0 ? 6 : -6,
  }));
  const map = Object.fromEntries(filters.map((filter) => [filter.id, filter]));
  const state = { ...getDefaultState(), filters: map };
  const lines = Object.fromEntries(
    filters.map((filter) => [filter.id, getFilterLineData(filter)])
  );
  const combined = getCombinedLineData(-6, lines);
  const config = stateToString(state);

  expect(config.match(/ON IIR Order 2/g)).toHaveLength(3);
  filters.forEach((_filter, index) => {
    expect(config).toContain(`Eval: aquaEq${index}w`);
    expect(config).toContain(`Filter${index}: ON IIR`);
  });
  combined.forEach(({ y }, index) => {
    const expected =
      -6 + Object.values(lines).reduce((sum, line) => sum + line[index].y, 0);
    expect(y).toBeCloseTo(expected, 10);
  });
});
