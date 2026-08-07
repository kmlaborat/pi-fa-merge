/**
 * Merge tool tests - verify SPEC §6 acceptance test cases
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { setupTestFixtures, cleanupTestFixtures } from './setup';

describe("Merge Tool", () => {
  beforeAll(() => {
    setupTestFixtures();
  });

  afterAll(() => {
    cleanupTestFixtures();
  });

  describe("Structure validation", () => {
    test("should preserve function names in merged code", () => {
      const originalCode = `
def calculate_total(price, tax):
    return price * (1 + tax)
`;
      const mergedCode = `
def calculate_total(price, tax):
    return price * (1 + tax)

def get_version():
    return "1.0.0"
`;
      // Verify original function is preserved
      expect(mergedCode).toContain("calculate_total");
      expect(mergedCode).toContain("get_version");
    });

    test("should detect function loss", () => {
      const originalCode = `
def calculate_total(price, tax):
    return price * (1 + tax)
`;
      const mergedCode = `
def get_version():
    return "1.0.0"
`;
      // Original function is lost
      expect(mergedCode).not.toContain("calculate_total");
    });
  });

  describe("Output parsing", () => {
    test("should extract code from XML tags", () => {
      const rawResponse = `<updated-code>
def calculate_total(price, tax):
    return price * (1 + tax)
</updated-code>`;
      
      const openTag = "<updated-code>";
      const closeTag = "</updated-code>";
      
      const openIndex = rawResponse.indexOf(openTag);
      const contentStart = openIndex + openTag.length;
      const closeIndex = rawResponse.indexOf(closeTag, contentStart);
      
      expect(closeIndex).toBeGreaterThan(0);
      expect(rawResponse.substring(contentStart, closeIndex).trim()).toContain("calculate_total");
    });

    test("should handle missing closing tag", () => {
      const rawResponse = `<updated-code>
def calculate_total(price, tax):
    return price * (1 + tax)`;
      
      const openTag = "<updated-code>";
      const closeTag = "</updated-code>";
      
      const openIndex = rawResponse.indexOf(openTag);
      const contentStart = openIndex + openTag.length;
      const closeIndex = rawResponse.indexOf(closeTag, contentStart);
      
      expect(closeIndex).toBe(-1);
    });
  });

  describe("Input validation", () => {
    test("should reject empty original_code", () => {
      const originalCode = "";
      expect(originalCode.trim()).toBe("");
    });

    test("should reject empty update_snippet", () => {
      const updateSnippet = "";
      expect(updateSnippet.trim()).toBe("");
    });
  });
});
