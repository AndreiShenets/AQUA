import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { remote } from 'webdriverio';

// Some Electron-based terminals export this for their own Node subprocesses.
// The tested desktop app must start as Electron, not as a Node CLI.
delete process.env.ELECTRON_RUN_AS_NODE;

const root = fileURLToPath(new URL('../..', import.meta.url));
const binary = path.resolve(
  process.argv[2] || path.join(root, 'release/build/win-unpacked/AQUA.exe')
);
assert.ok(fs.existsSync(binary), `Package the Windows app first: ${binary}`);
const chromedriver = path.join(
  root,
  '.erb/chromedriver',
  `${process.platform}-${process.arch}`,
  'chromedriver.exe'
);
assert.ok(
  fs.existsSync(chromedriver),
  'Run npm run install:chromedriver first'
);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-smoke-'));
const eqBands = [
  { frequency: 500, type: 'BP_EQ', label: 'Band Pass EQ', gain: 6 },
  { frequency: 2000, type: 'LP_EQ', label: 'Low Pass EQ', gain: -6 },
  { frequency: 4000, type: 'HP_EQ', label: 'High Pass EQ', gain: 9 },
];
const readConfig = () =>
  fs.readFileSync(path.join(directory, 'config/aqua.txt'), 'utf8');

const launch = () =>
  remote({
    logLevel: 'error',
    connectionRetryCount: 0,
    connectionRetryTimeout: 60000,
    capabilities: {
      browserName: 'chrome',
      'goog:chromeOptions': {
        binary,
        args: [
          `--aqua-sandbox=${directory}`,
          '--aqua-sandbox-hidden',
          `--user-data-dir=${path.join(directory, 'user-data')}`,
        ],
      },
      'wdio:chromedriverOptions': {
        binary: chromedriver,
      },
    },
  });

const openRenderer = async () => {
  // ChromeDriver initializes the controlled target to about:blank.
  await driver.url(
    pathToFileURL(
      path.join(
        path.dirname(binary),
        'resources/app.asar/dist/renderer/index.html'
      )
    ).href
  );
};

let driver;
try {
  driver = await launch();
  await openRenderer();
  const dropdown = await driver.$('[aria-label="1000-filter-type"]');
  await dropdown.waitForExist({ timeout: 30000 });
  await driver.execute(() =>
    document.querySelector('[aria-label="1000-filter-type"]').click()
  );
  await driver.$('[aria-label="Band Pass Filter"]').waitForExist();
  await driver.execute(() =>
    document.querySelector('[aria-label="Band Pass Filter"]').click()
  );
  await driver.waitUntil(
    async () => {
      const file = path.join(directory, 'user-data/state.txt');
      return (
        fs.existsSync(file) &&
        fs.readFileSync(file, 'utf8').includes('"type":"BP"')
      );
    },
    { timeout: 10000, timeoutMsg: 'BP selection was not persisted' }
  );

  assert.equal(
    await driver.$('[aria-label="1000-gain-number"]').isEnabled(),
    false
  );
  const config = fs.readFileSync(
    path.join(directory, 'config/aqua.txt'),
    'utf8'
  );
  assert.match(config, /ON BP Fc 1000 Hz Q 1/);
  assert.doesNotMatch(config, /ON BP[^\r\n]*Gain/);

  for (const { frequency, type, label, gain } of eqBands) {
    await driver.execute((name) => {
      document.querySelector(`[aria-label="${name}-filter-type"]`).click();
    }, frequency);
    await driver.$(`[aria-label="${label}"]`).waitForExist();
    await driver.execute((name) => {
      document.querySelector(`[aria-label="${name}"]`).click();
    }, label);
    const input = await driver.$(`[aria-label="${frequency}-gain-number"]`);
    await driver.waitUntil(() => input.isEnabled(), { timeout: 10000 });
    // Native input events exercise the real renderer handlers while the sandbox
    // window stays hidden. Send focusout after React processes input: native
    // focus/blur need not fire for a hidden Electron window. React maps this
    // bubbling event to NumberInput's onBlur submission handler.
    await driver.execute(
      (name, value) => {
        const field = document.querySelector(
          `[aria-label="${name}-gain-number"]`
        );
        field.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        ).set.call(field, String(value));
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
      frequency,
      gain
    );
    await driver.execute((name) => {
      document
        .querySelector(`[aria-label="${name}-gain-number"]`)
        .dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }, frequency);
    await driver.waitUntil(
      () => {
        const state = JSON.parse(
          fs.readFileSync(path.join(directory, 'user-data/state.txt'), 'utf8')
        );
        return (
          Object.values(state.filters).some(
            (filter) =>
              filter.frequency === frequency &&
              filter.type === type &&
              filter.gain === gain
          ) && readConfig().includes(`# ${type}:`)
        );
      },
      { timeout: 10000, timeoutMsg: `${label} gain was not persisted/exported` }
    );
  }
  assert.equal(
    (readConfig().match(/ON IIR Order 2 Coefficients/g) || []).length,
    3
  );
  assert.match(readConfig(), /sampleRate/);
  assert.doesNotMatch(readConfig(), /ON (BP_EQ|LP_EQ|HP_EQ)/);
  const savedConfig = readConfig();

  const importedPreset = {
    preAmp: -6,
    filters: {
      imported1: {
        id: 'imported1',
        frequency: 3000,
        gain: 6,
        quality: 0.707,
        type: 'HP_EQ',
      },
    },
  };
  const savedState = fs.readFileSync(
    path.join(directory, 'user-data/state.txt'),
    'utf8'
  );
  await driver.execute((content) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([content], 'Smoke imported.json', { type: 'application/json' })
    );
    transfer.items.add(
      new File(['{}'], 'Invalid preset.json', { type: 'application/json' })
    );
    transfer.items.add(
      new File([content], 'Smoke imported.json', { type: 'application/json' })
    );
    document.querySelector('[aria-label="preset-items"]').dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      })
    );
  }, JSON.stringify(importedPreset));
  await driver.waitUntil(
    () =>
      driver.execute(() => {
        const messages =
          document.querySelector('.preset-import-results')?.textContent || '';
        return (
          messages.includes('Imported as') &&
          messages.includes('Preamp must be') &&
          messages.includes('already exists')
        );
      }),
    {
      timeout: 10000,
      timeoutMsg: 'Dropped presets were not imported/rejected correctly',
    }
  );
  await driver.$('[aria-label="Smoke imported"]').waitForExist();
  const compactLayout = await driver.execute(() => {
    const list = document.querySelector('[aria-label="preset-items"]');
    const load = document
      .querySelector('[aria-label="Load selected preset"]')
      .getBoundingClientRect();
    const open = document
      .querySelector('[aria-label="Open preset files"]')
      .getBoundingClientRect();
    const messages = document
      .querySelector('.preset-import-results')
      .getBoundingClientRect();
    return {
      listIsDropTarget: document
        .querySelector('[aria-label="Preset import"]')
        .contains(list),
      pickerHidden:
        getComputedStyle(
          document.querySelector('[aria-label="Import AQUA preset files"]')
        ).display === 'none',
      openBesideLoad:
        open.left >= load.right && Math.abs(open.top - load.top) < 1,
      messagesBelowButtons: messages.top >= Math.max(open.bottom, load.bottom),
      noTopImportBar: !document.body.textContent.includes(
        'Drop AQUA preset files here, or choose files'
      ),
    };
  });
  assert.ok(
    Object.values(compactLayout).every(Boolean),
    JSON.stringify(compactLayout)
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(directory, 'user-data/presets/Smoke imported'),
        'utf8'
      )
    ),
    importedPreset
  );
  assert.equal(
    fs.existsSync(path.join(directory, 'user-data/presets/Invalid preset')),
    false
  );
  assert.equal(
    fs.readFileSync(path.join(directory, 'user-data/state.txt'), 'utf8'),
    savedState
  );
  assert.equal(readConfig(), savedConfig);

  await driver.deleteSession();
  driver = undefined;
  driver = await launch();
  await openRenderer();
  await driver
    .$('[aria-label="1000-filter-type"]')
    .waitForExist({ timeout: 30000 });
  await driver.$('[aria-label="Smoke imported"]').waitForExist();
  await driver
    .$('[aria-label="1000-filter-type"] > svg:first-child title')
    .waitForExist();
  assert.equal(
    await driver
      .$('[aria-label="1000-filter-type"] > svg:first-child title')
      .getProperty('textContent'),
    'Band Pass Filter'
  );
  assert.equal(
    await driver.$('[aria-label="1000-gain-number"]').isEnabled(),
    false
  );
  for (const { frequency, label, gain } of eqBands) {
    assert.equal(
      await driver
        .$(`[aria-label="${frequency}-filter-type"] > svg:first-child title`)
        .getProperty('textContent'),
      label
    );
    const input = await driver.$(`[aria-label="${frequency}-gain-number"]`);
    assert.equal(await input.isEnabled(), true);
    assert.equal(Number(await input.getValue()), gain);
  }
  assert.equal(readConfig(), savedConfig);
  console.log(
    'Packaged smoke test passed: legacy BP, BP/LP/HP EQ, preset drop import, invalid/duplicate rejection, unchanged active settings, and persistence after restart.'
  );
} catch (error) {
  if (driver) {
    console.error(
      '[smoke failure]',
      await driver
        .execute(() => ({
          url: location.href,
          readyState: document.readyState,
          bridgeAvailable: typeof window.electron?.ipcRenderer?.sendMessage,
          body: document.body?.innerText.slice(0, 2000),
        }))
        .catch(() => 'Unable to read the renderer')
    );
  }
  throw error;
} finally {
  await driver?.deleteSession();
  fs.rmSync(directory, { recursive: true, force: true });
}
