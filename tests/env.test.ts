/**
 * Tests for the package .env loader (extensions/env.ts), aligned with
 * pi-fc-search's design: prefix filtering, overwrite precedence, and
 * runtime reload semantics.
 */

import { describe, test, expect, afterAll, beforeAll } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import {
  applyEnvContent,
  reloadEnvFile,
  getEnvPath,
  ENV_KEY_PREFIXES,
} from '../extensions/env';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');

describe('applyEnvContent', () => {
  test('applies FAST_APPLY_* and ANCHOREDIT_* keys', () => {
    const env: NodeJS.ProcessEnv = {};
    const ignored = applyEnvContent(
      'FAST_APPLY_API_KEY=secret\nANCHOREDIT_BIN=/opt/anchoredit\n',
      env,
    );
    expect(env.FAST_APPLY_API_KEY).toBe('secret');
    expect(env.ANCHOREDIT_BIN).toBe('/opt/anchoredit');
    expect(ignored).toEqual([]);
  });

  test('package .env overrides existing process env (single source of truth)', () => {
    const env: NodeJS.ProcessEnv = { FAST_APPLY_MODEL_NAME: 'stale-model' };
    applyEnvContent('FAST_APPLY_MODEL_NAME=fresh-model\n', env);
    expect(env.FAST_APPLY_MODEL_NAME).toBe('fresh-model');
  });

  test('ignores and reports non-prefixed keys', () => {
    const env: NodeJS.ProcessEnv = {};
    const ignored = applyEnvContent(
      'PATH=/hijacked\nNODE_ENV=production\nFAST_APPLY_API_KEY=k\n',
      env,
    );
    expect(ignored).toEqual(['PATH', 'NODE_ENV']);
    expect(env.PATH).toBeUndefined();
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.FAST_APPLY_API_KEY).toBe('k');
  });

  test('strips surrounding quotes', () => {
    const env: NodeJS.ProcessEnv = {};
    applyEnvContent(
      'FAST_APPLY_ENDPOINT_URL="https://api.example.com/v1"\nFAST_APPLY_MODEL_NAME=\'fast-apply-7b\'\n',
      env,
    );
    expect(env.FAST_APPLY_ENDPOINT_URL).toBe('https://api.example.com/v1');
    expect(env.FAST_APPLY_MODEL_NAME).toBe('fast-apply-7b');
  });

  test('skips comments, blank lines and malformed lines', () => {
    const env: NodeJS.ProcessEnv = {};
    const ignored = applyEnvContent(
      '# a comment\n\n   \nno-equals-sign\n=missing-key\nFAST_APPLY_TIMEOUT=30000\n',
      env,
    );
    expect(env.FAST_APPLY_TIMEOUT).toBe('30000');
    expect(ignored).toEqual([]);
  });

  test('supports CRLF line endings', () => {
    const env: NodeJS.ProcessEnv = {};
    applyEnvContent('FAST_APPLY_TIMEOUT=1\r\nFAST_APPLY_MODEL_NAME=m\r\n', env);
    expect(env.FAST_APPLY_TIMEOUT).toBe('1');
    expect(env.FAST_APPLY_MODEL_NAME).toBe('m');
  });

  test('only writes, never deletes: keys missing from the file remain', () => {
    const env: NodeJS.ProcessEnv = { FAST_APPLY_REMOVED_KEY: 'stays' };
    applyEnvContent('FAST_APPLY_OTHER_KEY=1\n', env);
    expect(env.FAST_APPLY_REMOVED_KEY).toBe('stays');
    expect(env.FAST_APPLY_OTHER_KEY).toBe('1');
  });
});

describe('getEnvPath', () => {
  test('resolves the package-root .env', () => {
    expect(getEnvPath()).toBe(resolve(PACKAGE_ROOT, '.env'));
  });
});

describe('reloadEnvFile', () => {
  const hasLocalEnv = fs.existsSync(getEnvPath());
  // Never clobber a real local .env during tests.
  const maybe = hasLocalEnv ? test.skip : test;

  maybe('reloads a present .env and reports applied/ignored keys', () => {
    const envPath = getEnvPath();
    fs.writeFileSync(
      envPath,
      '# test fixture\nFAST_APPLY_TEST_RELOAD=1\nPATH=/should-be-ignored\n',
      'utf-8',
    );
    try {
      const result = reloadEnvFile();
      expect(result.found).toBe(true);
      expect(result.envPath).toBe(envPath);
      expect(result.appliedKeys).toEqual(['FAST_APPLY_TEST_RELOAD']);
      expect(result.ignoredKeys).toEqual(['PATH']);
      expect(process.env.FAST_APPLY_TEST_RELOAD).toBe('1');
    } finally {
      fs.unlinkSync(envPath);
      delete process.env.FAST_APPLY_TEST_RELOAD;
    }
  });

  maybe('reports found:false when no .env exists', () => {
    const result = reloadEnvFile();
    expect(result.found).toBe(false);
    expect(result.appliedKeys).toEqual([]);
    expect(result.ignoredKeys).toEqual([]);
  });
});

describe('ENV_KEY_PREFIXES', () => {
  test('covers the keys documented in .env.example', () => {
    expect(ENV_KEY_PREFIXES).toContain('FAST_APPLY_');
    expect(ENV_KEY_PREFIXES).toContain('ANCHOREDIT_');
  });
});
