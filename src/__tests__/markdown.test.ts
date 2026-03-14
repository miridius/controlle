/**
 * Tests for markdown.ts: GFM → Telegram HTML conversion.
 */
import { describe, expect, test } from "bun:test";
import { gfmToTelegramHtml } from "../markdown";

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
