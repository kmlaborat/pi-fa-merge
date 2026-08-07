/**
 * Test setup and utilities
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";

// Vitest compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TEST_FIXTURES_DIR = resolve(__dirname, "..", "__test_fixtures__");

// Create fixture files and directories before tests run
export function setupTestFixtures(): void {
  if (!fs.existsSync(TEST_FIXTURES_DIR)) {
    fs.mkdirSync(TEST_FIXTURES_DIR, { recursive: true });
  }

  // Create test files with known content for validation
  fs.writeFileSync(resolve(TEST_FIXTURES_DIR, "test.ts"), `// This is a test file
export function test() {
  return "world";
}
`, "utf-8");
}

// Clean up test fixtures after tests
export function cleanupTestFixtures(): void {
  if (fs.existsSync(TEST_FIXTURES_DIR)) {
    try {
      fs.rmSync(TEST_FIXTURES_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Helper to verify Python parity - check that outputs match expected patterns
export function matchesPythonOutput(actual: string, expectedPattern: string | RegExp): boolean {
  if (typeof expectedPattern === "string") {
    return actual.includes(expectedPattern);
  }
  return expectedPattern.test(actual);
}
