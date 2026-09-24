export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

export function stripHtmlToPlainText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ""));
}

export function cleanAssistantText(rawText: string): string {
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, "");
  return cleaned.trim();
}

/**
 * Robust Telegram HTML Formatter:
 * Converts Markdown to Telegram-compliant HTML subset:
 * <b>, <i>, <u>, <s>, <span>, <tg-spoiler>, <a>, <code>, <pre>, <blockquote>
 */
export function markdownToTelegramHtml(input: string): string {
  // 1. Extract and format code blocks first
  const codeBlocks: string[] = [];
  let text = input.replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_match, lang, code) => {
      const idx = codeBlocks.length;
      const escapedCode = escapeHtml(code);
      codeBlocks.push(
        `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapedCode}</code></pre>`,
      );
      return `@@TG_CODE_BLOCK_${idx}@@`;
    },
  );

  // 2. Extract and format inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `@@TG_INLINE_CODE_${idx}@@`;
  });

  // 3. Preserve any pre-existing valid Telegram HTML tags
  const preservedTags: string[] = [];
  const tagRegex =
    /<\/?(?:b|strong|i|em|u|ins|s|strike|del|span|tg-spoiler|tg-emoji|code|pre|blockquote)(?:\s+[^>]*)?>|<a\s+(?:[^>]*?\s+)?href="[^"]*"(?:\s+[^>]*)?>|<\/a>/gi;
  text = text.replace(tagRegex, (match) => {
    const idx = preservedTags.length;
    preservedTags.push(match);
    return `@@TG_PRESERVED_TAG_${idx}@@`;
  });

  // 4. Preserve existing valid HTML entities (like &lt; &gt; &amp;)
  const preservedEntities: string[] = [];
  text = text.replace(/&(?:amp|lt|gt|quot|#039|#x?[0-9a-fA-F]+);/g, (match) => {
    const idx = preservedEntities.length;
    preservedEntities.push(match);
    return `@@TG_PRESERVED_ENT_${idx}@@`;
  });

  // 5. Blockquotes: > quote
  text = text.replace(/(?:^>[^\n]*(?:\n|$))+/gm, (match) => {
    const content = match
      .split("\n")
      .map((line) => line.replace(/^>\s?/, "").trimEnd())
      .join("\n")
      .trim();
    return `@@TG_QUOTE_START@@${content}@@TG_QUOTE_END@@\n`;
  });

  // 6. Headers: #, ##, ###
  text = text.replace(/^#{1,6}\s+(.*)$/gm, "@@TG_HEADER_START@@$1@@TG_HEADER_END@@");

  // 7. Escape remaining raw HTML special characters
  text = escapeHtml(text);

  // 8. Convert Header & Quote placeholders to actual tags
  text = text.replace(/@@TG_HEADER_START@@([\s\S]*?)@@TG_HEADER_END@@/g, "<b>$1</b>");
  text = text.replace(/@@TG_QUOTE_START@@([\s\S]*?)@@TG_QUOTE_END@@/g, "<blockquote>$1</blockquote>");

  // 9. Restore preserved entities
  text = text.replace(/@@TG_PRESERVED_ENT_(\d+)@@/g, (_m, idx) => preservedEntities[Number(idx)]);

  // 10. Markdown links: [title](url)
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // 11. Markdown bold, italic, strikethrough
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  text = text.replace(/(^|[^*])\*([^*\n\r]+)\*(?!\*)/g, "$1<i>$2</i>");
  text = text.replace(/(^|[^_])_([^_\n\r]+)_(?!_)/g, "$1<i>$2</i>");
  text = text.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");

  // 12. Markdown Table fallback for Telegram: Format tables cleanly as monospace preformatted blocks
  const rawLines = text.split("\n");
  const processedBlocks: string[] = [];
  let currentTable: string[] = [];

  const flushTable = () => {
    if (currentTable.length > 0) {
      if (currentTable.length >= 2 && currentTable[0].includes("|") && currentTable[1].includes("|")) {
        const tableText = currentTable.join("\n");
        processedBlocks.push(`<pre>${tableText}</pre>`);
      } else {
        processedBlocks.push(...currentTable);
      }
      currentTable = [];
    }
  };

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 2) {
      currentTable.push(trimmed);
    } else {
      flushTable();
      processedBlocks.push(line);
    }
  }
  flushTable();
  text = processedBlocks.join("\n");

  // 13. Restore preserved HTML tags
  text = text.replace(/@@TG_PRESERVED_TAG_(\d+)@@/g, (_m, idx) => preservedTags[Number(idx)]);

  // 14. Restore code blocks & inline code
  text = text.replace(/@@TG_CODE_BLOCK_(\d+)@@/g, (_m, idx) => codeBlocks[Number(idx)]);
  text = text.replace(/@@TG_INLINE_CODE_(\d+)@@/g, (_m, idx) => inlineCodes[Number(idx)]);

  return text;
}
