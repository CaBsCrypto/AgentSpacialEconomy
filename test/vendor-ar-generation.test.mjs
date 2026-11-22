import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('AR vendoring produces the same verified bytes from LF and CRLF license sources', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-license-'));
  try {
    const sources = path.join(temporary, 'sources');
    const three = path.join(sources, 'three/package'), mindar = path.join(sources, 'mind-ar/package');
    fs.cpSync(path.join(root, 'dist/vendor/ar-three'), three, { recursive: true });
    fs.mkdirSync(path.join(mindar, 'dist'), { recursive: true });
    fs.cpSync(path.join(root, 'dist/vendor/mindar'), path.join(mindar, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(three, 'package.json'), '{"version":"0.160.0"}');
    fs.writeFileSync(path.join(mindar, 'package.json'), '{"version":"1.2.5"}');
    const license = fs.readFileSync(path.join(root, 'dist/vendor/mindar/LICENSE'), 'utf8').replace(/\r\n?/g, '\n');
    let previous;
    for (const ending of ['\n', '\r\n']) {
      fs.writeFileSync(path.join(mindar, 'LICENSE'), license.replaceAll('\n', ending));
      execFileSync(process.execPath, [path.join(root, 'scripts/vendor-ar.mjs'), sources], { cwd: temporary, windowsHide: true });
      const manifest = JSON.parse(fs.readFileSync(path.join(temporary, 'dist/vendor/ar-runtime.json')));
      for (const entry of manifest.files) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(temporary, entry.file))).digest('hex'), entry.sha256, entry.file);
      if (previous) assert.deepEqual(manifest, previous);
      previous = manifest;
      assert.equal(fs.readFileSync(path.join(temporary, 'dist/vendor/mindar/LICENSE'), 'utf8'), license);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('ar-license-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
