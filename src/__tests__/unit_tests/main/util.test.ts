import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveHtmlPath } from 'main/util';

it('creates a valid packaged file URL, including paths containing spaces', () => {
  const expected = pathToFileURL(
    path.resolve(__dirname, '../../../main/../renderer/page with spaces.html')
  ).href;

  expect(resolveHtmlPath('page with spaces.html')).toBe(expected);
  expect(resolveHtmlPath('page with spaces.html')).not.toContain(' ');
});
