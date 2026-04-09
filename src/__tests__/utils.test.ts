import { describe, expect, test } from "bun:test";
import { escapeHtml, severityIcon } from "../utils";

describe("escapeHtml", () => {
  test("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("escapes angle brackets", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  test("escapes all special characters together", () => {
    expect(escapeHtml("<b>A & B</b>")).toBe("&lt;b&gt;A &amp; B&lt;/b&gt;");
  });

  test("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  test("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("severityIcon", () => {
  test("critical returns red circle", () => {
    expect(severityIcon("critical")).toBe("🔴");
  });

  test("high returns orange circle", () => {
    expect(severityIcon("high")).toBe("🟠");
  });

  test("medium returns yellow circle", () => {
    expect(severityIcon("medium")).toBe("🟡");
  });

  test("unknown severity returns blue circle", () => {
    expect(severityIcon("low")).toBe("🔵");
    expect(severityIcon("info")).toBe("🔵");
  });
});
