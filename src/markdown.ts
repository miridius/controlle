/**
 * Convert GitHub-flavored Markdown (as Claude outputs) to Telegram HTML.
 *
 * Handles: code blocks, inline code, bold, italic, strikethrough, links.
 * Falls back gracefully — unrecognised patterns pass through as escaped text.
 */
import { escapeHtml as esc } from "./utils";

/** Convert inline GFM formatting to Telegram HTML (called on non-code text) */
function convertInline(text: string): string {
  // Split on inline code spans so we don't mangle their contents
  const parts = text.split(/(`[^`\n]+`)/g);

  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        // Inline code — escape contents, wrap in <code>
        return `<code>${esc(part.slice(1, -1))}</code>`;
      }
      // Regular text — escape HTML first, then convert formatting
      let s = esc(part);
      // Bold: **text** → <b>text</b>  (must come before italic)
      s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      // Italic: *text* → <i>text</i>
      s = s.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<i>$1</i>");
      // Strikethrough: ~~text~~ → <s>text</s>
      s = s.replace(/~~(.+?)~~/g, "<s>$1</s>");
      // Links: [text](url) → <a href="url">text</a>
      s = s.replace(
        /\[(.+?)\]\((.+?)\)/g,
        '<a href="$2">$1</a>',
      );
      return s;
    })
    .join("");
}

/**
 * Convert a GFM markdown string to Telegram-compatible HTML.
 *
 * Code blocks are extracted first (preserving language hints as-is),
 * then inline formatting is converted in the remaining text.
 */
export function gfmToTelegramHtml(text: string): string {
  // Split on fenced code blocks (``` ... ```)
  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts
    .map((part) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        // Strip the fences and optional language tag
        const inner = part.slice(3, -3);
        const newlineIdx = inner.indexOf("\n");
        // If there's a language tag on the first line, skip it
        const code =
          newlineIdx >= 0 && /^\w*$/.test(inner.slice(0, newlineIdx))
            ? inner.slice(newlineIdx + 1)
            : inner;
        return `<pre>${esc(code)}</pre>`;
      }
      return convertInline(part);
    })
    .join("");
}
