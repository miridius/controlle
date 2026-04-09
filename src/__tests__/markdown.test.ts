/**
 * Tests for markdown.ts: GFM → Telegram HTML conversion.
 */
import { describe, expect, test } from "bun:test";
import { gfmToTelegramHtml, truncateHtml } from "../markdown";

describe("gfmToTelegramHtml", () => {
  test("plain text passes through", () => {
    expect(gfmToTelegramHtml("hello world")).toBe("hello world");
  });

  test("escapes HTML entities in plain text", () => {
    expect(gfmToTelegramHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  test("converts **bold** to <b>", () => {
    expect(gfmToTelegramHtml("hello **bold** world")).toBe(
      "hello <b>bold</b> world",
    );
  });

  test("converts *italic* to <i>", () => {
    expect(gfmToTelegramHtml("hello *italic* world")).toBe(
      "hello <i>italic</i> world",
    );
  });

  test("bold and italic together", () => {
    expect(gfmToTelegramHtml("**bold** and *italic*")).toBe(
      "<b>bold</b> and <i>italic</i>",
    );
  });

  test("converts ~~strikethrough~~ to <s>", () => {
    expect(gfmToTelegramHtml("~~deleted~~")).toBe("<s>deleted</s>");
  });

  test("converts inline `code` to <code>", () => {
    expect(gfmToTelegramHtml("run `npm test` now")).toBe(
      "run <code>npm test</code> now",
    );
  });

  test("escapes HTML inside inline code", () => {
    expect(gfmToTelegramHtml("use `<div>` tag")).toBe(
      "use <code>&lt;div&gt;</code> tag",
    );
  });

  test("converts fenced code blocks to <pre>", () => {
    expect(gfmToTelegramHtml("```\ncode here\n```")).toBe(
      "<pre>code here\n</pre>",
    );
  });

  test("strips language tag from code blocks", () => {
    expect(gfmToTelegramHtml("```typescript\nconst x = 1;\n```")).toBe(
      "<pre>const x = 1;\n</pre>",
    );
  });

  test("escapes HTML inside code blocks", () => {
    expect(gfmToTelegramHtml("```\n<script>alert(1)</script>\n```")).toBe(
      "<pre>&lt;script&gt;alert(1)&lt;/script&gt;\n</pre>",
    );
  });

  test("converts [text](url) links to <a>", () => {
    expect(gfmToTelegramHtml("see [docs](https://example.com)")).toBe(
      'see <a href="https://example.com">docs</a>',
    );
  });

  test("handles mixed formatting in one message", () => {
    const input = "**bold** with `code` and *italic*";
    const expected = "<b>bold</b> with <code>code</code> and <i>italic</i>";
    expect(gfmToTelegramHtml(input)).toBe(expected);
  });

  test("does not process formatting inside code blocks", () => {
    expect(gfmToTelegramHtml("```\n**not bold**\n```")).toBe(
      "<pre>**not bold**\n</pre>",
    );
  });

  test("does not process formatting inside inline code", () => {
    expect(gfmToTelegramHtml("`**not bold**`")).toBe(
      "<code>**not bold**</code>",
    );
  });

  test("handles multiple code blocks", () => {
    const input = "before\n```\nblock1\n```\nmiddle\n```\nblock2\n```\nafter";
    const expected =
      "before\n<pre>block1\n</pre>\nmiddle\n<pre>block2\n</pre>\nafter";
    expect(gfmToTelegramHtml(input)).toBe(expected);
  });

  test("handles empty input", () => {
    expect(gfmToTelegramHtml("")).toBe("");
  });
});

describe("truncateHtml", () => {
  test("returns short HTML unchanged", () => {
    expect(truncateHtml("<b>hello</b>")).toBe("<b>hello</b>");
  });

  test("returns HTML at exactly max length unchanged", () => {
    const html = "x".repeat(4000);
    expect(truncateHtml(html)).toBe(html);
  });

  test("truncates long HTML and appends marker", () => {
    const html = "x".repeat(5000);
    const result = truncateHtml(html, 200);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toEndWith("[...truncated]");
  });

  test("does not cut inside an HTML tag", () => {
    // Place a tag right at the cut boundary
    const prefix = "x".repeat(80);
    const html = prefix + '<b>bold text</b>' + "y".repeat(200);
    const result = truncateHtml(html, 90);
    // Should not contain a partial tag like '<b' without closing '>'
    expect(result).not.toMatch(/<[^>]*$/);
  });

  test("closes unclosed tags after truncation", () => {
    const html = "<b>" + "x".repeat(5000) + "</b>";
    const result = truncateHtml(html, 200);
    expect(result).toContain("</b>");
    expect(result).toEndWith("[...truncated]");
  });

  test("closes nested unclosed tags in reverse order", () => {
    const html = "<b><i>" + "x".repeat(5000) + "</i></b>";
    const result = truncateHtml(html, 200);
    // Should close </i> then </b> before the suffix
    expect(result).toContain("</i></b>");
  });

  test("does not double-close already-closed tags", () => {
    const html = "<b>done</b> " + "x".repeat(5000);
    const result = truncateHtml(html, 200);
    // <b> was already closed, should not appear in closers
    const closingBCount = (result.match(/<\/b>/g) || []).length;
    expect(closingBCount).toBe(1); // only the original
  });

  test("handles pre tags from code blocks", () => {
    const html = "<pre>" + "x".repeat(5000) + "</pre>";
    const result = truncateHtml(html, 200);
    expect(result).toContain("</pre>");
    expect(result).toEndWith("[...truncated]");
  });

  test("respects custom max length", () => {
    const html = "x".repeat(500);
    const result = truncateHtml(html, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});
