/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('electron', () => ({
  app: {
    commandLine: { getSwitchValue: jest.fn() },
    setPath: jest.fn(),
  },
}));

const mockApp = () =>
  jest.mocked((require('electron') as typeof import('electron')).app);

describe('isolated sandbox', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('does not redirect paths unless explicitly requested', () => {
    const app = mockApp();
    app.commandLine.getSwitchValue.mockReturnValue('');

    const sandbox = require('main/sandbox');

    expect(sandbox.isSandbox).toBe(false);
    expect(sandbox.sandboxConfigPath).toBeUndefined();
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('rejects a relative sandbox path before changing any paths', () => {
    const app = mockApp();
    app.commandLine.getSwitchValue.mockReturnValue('relative-path');

    expect(() => require('main/sandbox')).toThrow(
      'requires an absolute directory'
    );
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('creates separate config and user-data directories without overwriting existing config', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aqua-sandbox-test-')
    );
    const app = mockApp();
    app.commandLine.getSwitchValue.mockReturnValue(directory);

    try {
      const sandbox = require('main/sandbox');
      const config = path.join(directory, 'config/config.txt');

      expect(sandbox.isSandbox).toBe(true);
      expect(sandbox.sandboxConfigPath).toBe(path.join(directory, 'config'));
      expect(app.setPath).toHaveBeenCalledWith(
        'userData',
        path.join(directory, 'user-data')
      );
      expect(fs.readFileSync(config, 'utf8')).toBe('Include: aqua.txt\n');

      fs.writeFileSync(config, '# existing sandbox configuration\n');
      jest.resetModules();
      mockApp().commandLine.getSwitchValue.mockReturnValue(directory);
      require('main/sandbox');

      expect(fs.readFileSync(config, 'utf8')).toBe(
        '# existing sandbox configuration\n'
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
