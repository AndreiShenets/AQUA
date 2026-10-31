import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// Explicit opt-in for testing a packaged build without touching live presets,
// Equalizer APO configuration, filesystem flags, or automatic updates.
const directory = app?.commandLine.getSwitchValue('aqua-sandbox');
export const isSandbox = Boolean(directory);
export const sandboxConfigPath = directory
  ? path.join(directory, 'config')
  : undefined;

if (directory) {
  if (!path.isAbsolute(directory)) {
    throw new Error('--aqua-sandbox requires an absolute directory');
  }

  const userData = path.join(directory, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(sandboxConfigPath!, { recursive: true });
  const configFile = path.join(sandboxConfigPath!, 'config.txt');
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, 'Include: aqua.txt\n');
  }
  app.setPath('userData', userData);
}
