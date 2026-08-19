/**
 * Merge tool tests - verify SPEC §6 acceptance test cases and unit-test
 * the pure functions exported from extensions/index.ts.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import * as fs from 'fs';
import {
  buildPrompt,
  parseOutput,
  validateStructure,
  isRetryable,
  resolveFilePath,
  buildApplyArgs,
  writePayloadTempFile,
  removeTempFile,
  MAX_ARGV_PAYLOAD_CHARS,
} from '../extensions/index';
import {
  setupTestFixtures,
  cleanupTestFixtures,
  TEST_FIXTURES_DIR,
} from './setup';

const CALCULATE_TOTAL_SOURCE = `def calculate_total(price, tax):
    return price * (1 + tax)`;

describe('Merge Tool', () => {
  beforeAll(() => {
    setupTestFixtures();
  });

  afterAll(() => {
    cleanupTestFixtures();
  });

  describe('buildPrompt', () => {
    test('embeds source code inside <code> tags', () => {
      const prompt = buildPrompt('def f():\n    pass', 'add docstring');
      expect(prompt).toContain('<code>\ndef f():\n    pass\n</code>');
    });

    test('embeds instruction inside <update> tags', () => {
      const prompt = buildPrompt('def f():\n    pass', 'add docstring');
      expect(prompt).toContain('<update>\nadd docstring\n</update>');
    });

    test('instructs the model to output <updated-code> tags', () => {
      const prompt = buildPrompt('def f():\n    pass', 'change body');
      expect(prompt).toContain('<updated-code>');
      expect(prompt).toContain('</updated-code>');
    });
  });

  describe('parseOutput (SPEC §6)', () => {
    test('Test Case 1: normal merge (adding a function to Python code)', () => {
      const rawResponse = `<updated-code>
def calculate_total(price, tax):
    return price * (1 + tax)

def get_version():
    return "1.0.0"
</updated-code>`;

      const result = parseOutput(rawResponse, CALCULATE_TOTAL_SOURCE);

      expect(result.success).toBe(true);
      expect(result.updated_code).toBe(
        `def calculate_total(price, tax):
    return price * (1 + tax)

def get_version():
    return "1.0.0"`,
      );
      expect(result.error).toBeUndefined();
    });

    test('Test Case 2: partial rewrite preserving indentation', () => {
      const source = `class User:
    def greet(self):
        print("Hello")
        return False`;
      const rawResponse = `<updated-code>
class User:
    def greet(self):
        print("Hello World")
        return True
</updated-code>`;

      const result = parseOutput(rawResponse, source);

      expect(result.success).toBe(true);
      expect(result.updated_code).toBe(
        `class User:
    def greet(self):
        print("Hello World")
        return True`,
      );
    });

    test('Test Case 3: malformed output (missing closing tag)', () => {
      const rawResponse = `<updated-code>def incomplete():`;

      const result = parseOutput(rawResponse, CALCULATE_TOTAL_SOURCE);

      expect(result.success).toBe(false);
      expect(result.error).toBe('MALFORMED_OUTPUT');
      expect(result.details).toBe('Closing tag </updated-code> was not found.');
    });

    test('missing opening tag is malformed', () => {
      const result = parseOutput('def f():\n    pass', CALCULATE_TOTAL_SOURCE);

      expect(result.success).toBe(false);
      expect(result.error).toBe('MALFORMED_OUTPUT');
      expect(result.details).toBe('Opening tag <updated-code> was not found.');
    });

    test('strips markdown code fences inside the tags', () => {
      const rawResponse = `<updated-code>
\`\`\`python
def get_version():
    return "1.0.0"
\`\`\`
</updated-code>`;

      const result = parseOutput(
        rawResponse,
        `def get_version():
    return "0.9.0"`,
      );

      expect(result.success).toBe(true);
      expect(result.updated_code).toBe(
        `def get_version():
    return "1.0.0"`,
      );
    });

    test('structure mangle (function lost) is rejected before returning code', () => {
      const rawResponse = `<updated-code>
def helper():
    return 1
</updated-code>`;

      const result = parseOutput(
        rawResponse,
        `def calculate_total(price, tax):
    return price * (1 + tax)

def helper():
    return 1`,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('STRUCTURE_MANGLE_ERROR');
      expect(result.details).toContain('calculate_total');
    });
  });

  describe('validateStructure', () => {
    test('accepts valid transformed code', () => {
      const source = `def f():
    return 1`;
      const updated = `def f():
    return 2`;
      expect(validateStructure(source, updated)).toEqual({ valid: true });
    });

    test('detects lost function/class name', () => {
      const result = validateStructure(
        `def calculate_total(price, tax):
    return price * (1 + tax)`,
        `def something_else():
    return 1`,
      );
      expect(result.valid).toBe(false);
      expect(result.details).toContain('calculate_total');
    });

    test('detects all imports lost', () => {
      const result = validateStructure(
        `import os

def f():
    return os.getpid()`,
        `def f():
    return 1`,
      );
      expect(result.valid).toBe(false);
      expect(result.details).toContain('imports');
    });

    test('detects more than 50% line loss', () => {
      const source =
        Array.from({ length: 20 }, (_, i) => `# line ${i}`).join('\n') +
        `\ndef f():
    return 1`;
      const result = validateStructure(
        source,
        `def f():
    return 1`,
      );
      expect(result.valid).toBe(false);
      expect(result.details).toContain('lost too many lines');
    });

    test('detects lost prefix for files longer than 5 lines', () => {
      const sourceLines = [
        'def f():',
        '    x = 1',
        '    y = 2',
        '    z = 3',
        '    w = 4',
        '    v = 5',
        ...Array.from({ length: 22 }, (_, i) => `    t${i} = ${i}`),
        '    return x',
      ];
      expect(sourceLines.length).toBeGreaterThan(5);
      const source = sourceLines.join('\n');
      // Keeps function f and all lines, but adds a header at the top
      const updated = `# new header\n` + source;

      const result = validateStructure(source, updated);
      expect(result.valid).toBe(false);
      expect(result.details).toContain('prefix');
    });

    test('skips prefix check for very small files (5 lines or less)', () => {
      const source = `def f():
    a = 1
    b = 2
    return a + b`;
      const updated = `# note
def f():
    a = 1
    b = 2
    return a + b`;
      expect(validateStructure(source, updated)).toEqual({ valid: true });
    });
  });

  describe('isRetryable', () => {
    test.each(['429', '500', '502', '503', '504'])(
      'retries on status %s',
      (status) => {
        expect(isRetryable(new Error(`API error: ${status} Bad`))).toBe(true);
      },
    );

    test.each(['401', '403', '404'])('does not retry on status %s', (status) => {
      expect(isRetryable(new Error(`API error: ${status} Bad`))).toBe(false);
    });

    test('does not retry on non-Error values', () => {
      expect(isRetryable('429')).toBe(false);
      expect(isRetryable(null)).toBe(false);
      expect(isRetryable(undefined)).toBe(false);
    });
  });

  describe('resolveFilePath', () => {
    const fixtureFile = 'test.ts';
    const fixtureAbsolute = resolve(TEST_FIXTURES_DIR, fixtureFile);

    test('resolves an existing relative path against cwd', () => {
      expect(resolveFilePath(fixtureFile, TEST_FIXTURES_DIR)).toBe(
        fixtureAbsolute,
      );
    });

    test('returns an existing absolute path as-is', () => {
      expect(resolveFilePath(fixtureAbsolute, process.cwd())).toBe(
        fixtureAbsolute,
      );
    });

    test('falls back to the original path when the file does not exist', () => {
      expect(resolveFilePath('does-not-exist.ts', TEST_FIXTURES_DIR)).toBe(
        'does-not-exist.ts',
      );
    });

    test('Windows: drive-letter absolute paths pass through', () => {
      if (process.platform !== 'win32') return;
      expect(resolveFilePath('C:\\some\\file.rs', process.cwd())).toBe(
        'C:\\some\\file.rs',
      );
    });
  });

  describe('buildApplyArgs', () => {
    const file = '/tmp/target.py';

    test('short payloads use argv flags', () => {
      const args = buildApplyArgs(file, 'def f():', 'def f():\n    pass');
      expect(args).toEqual([
        'apply',
        '--file',
        file,
        '--anchor',
        'def f():',
        '--replacement',
        'def f():\n    pass',
      ]);
    });

    test('long replacement uses --replacement-file', () => {
      const replacement = 'x'.repeat(MAX_ARGV_PAYLOAD_CHARS + 1);
      const args = buildApplyArgs(file, 'def f():', replacement, {
        replacementFile: '/tmp/rep.tmp',
      });
      expect(args).toEqual([
        'apply',
        '--file',
        file,
        '--anchor',
        'def f():',
        '--replacement-file',
        '/tmp/rep.tmp',
      ]);
    });

    test('long anchor uses --anchor-file', () => {
      const anchor = 'a'.repeat(MAX_ARGV_PAYLOAD_CHARS + 1);
      const args = buildApplyArgs(file, anchor, 'new code', {
        anchorFile: '/tmp/anchor.tmp',
      });
      expect(args).toEqual([
        'apply',
        '--file',
        file,
        '--anchor-file',
        '/tmp/anchor.tmp',
        '--replacement',
        'new code',
      ]);
    });

    test('handles one short and one long payload', () => {
      const anchor = 'a'.repeat(MAX_ARGV_PAYLOAD_CHARS + 1);
      const replacement = 'r'.repeat(MAX_ARGV_PAYLOAD_CHARS + 1);
      const args = buildApplyArgs(file, anchor, replacement, {
        anchorFile: '/tmp/a.tmp',
        replacementFile: '/tmp/r.tmp',
      });
      expect(args).toEqual([
        'apply',
        '--file',
        file,
        '--anchor-file',
        '/tmp/a.tmp',
        '--replacement-file',
        '/tmp/r.tmp',
      ]);
    });

    test('payload of exactly the threshold stays in argv', () => {
      const replacement = 'x'.repeat(MAX_ARGV_PAYLOAD_CHARS);
      const args = buildApplyArgs(file, 'def f():', replacement);
      expect(args).toContain('--replacement');
    });

    test('throws when a long payload has no file', () => {
      const replacement = 'x'.repeat(MAX_ARGV_PAYLOAD_CHARS + 1);
      expect(() => buildApplyArgs(file, 'def f():', replacement)).toThrow(
        /replacementFile/,
      );
      const anchor = 'a'.repeat(MAX_ARGV_PAYLOAD_CHARS + 1);
      expect(() => buildApplyArgs(file, anchor, 'new code')).toThrow(
        /anchorFile/,
      );
    });
  });

  describe('payload temp files', () => {
    test('round-trips content verbatim (multibyte, no trailing newline)', async () => {
      const payload = 'def f():\n    return "日本"\n';
      const filePath = await writePayloadTempFile(payload);
      try {
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe(payload);
      } finally {
        await removeTempFile(filePath);
      }
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('does not add a trailing newline', async () => {
      const filePath = await writePayloadTempFile('no-newline');
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        expect(raw).toBe('no-newline');
        expect(raw.endsWith('\n')).toBe(false);
      } finally {
        await removeTempFile(filePath);
      }
    });

    test('generates unique file names', async () => {
      const p1 = await writePayloadTempFile('a');
      const p2 = await writePayloadTempFile('b');
      try {
        expect(p1).not.toBe(p2);
      } finally {
        await Promise.all([removeTempFile(p1), removeTempFile(p2)]);
      }
    });

    test('removeTempFile ignores missing files', async () => {
      await expect(
        removeTempFile('/tmp/fa-merge-does-not-exist.tmp'),
      ).resolves.toBeUndefined();
    });
  });
});
