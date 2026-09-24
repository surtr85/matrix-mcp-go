import * as path from "node:path";

export function cleanAssistantText(rawText: string): string {
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, "");
  return cleaned.trim();
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function isPersian(text: string): boolean {
  const textWithoutCode = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/https?:\/\/\S+/g, "");

  const persianRegex = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const firstStrong = textWithoutCode.match(
    /[A-Za-z]|[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/,
  );
  if (firstStrong) {
    return persianRegex.test(firstStrong[0]);
  }
  return persianRegex.test(textWithoutCode);
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".mp3":
      return "audio/mpeg";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".zip":
      return "application/zip";
    case ".txt":
    case ".md":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

export function renderMarkdownTable(tableLines: string[]): string {
  if (tableLines.length < 2) return tableLines.join("\n");

  const parseRow = (line: string): string[] => {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((cell) => cell.trim());
  };

  const headerCells = parseRow(tableLines[0]);
  const alignRow = parseRow(tableLines[1]);

  const isSeparator = alignRow.every((c) => /^:?-+:?$/.test(c));
  if (!isSeparator) {
    return tableLines.join("\n");
  }

  const alignments = alignRow.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });

  const bodyRows = tableLines.slice(2).map(parseRow);

  const allText = tableLines.join(" ");
  const isTableRtl = isPersian(allText);
  const tableDir = isTableRtl ? "rtl" : "ltr";
  const defaultAlign = isTableRtl ? "right" : "left";

  let out = `<div dir="${tableDir}" style="overflow-x: auto; margin: 10px 0;"><table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; border: 1px solid #555; width: 100%; text-align: ${defaultAlign}; font-size: 13px;">`;

  out += `<thead style="background-color: rgba(128, 128, 128, 0.2);"><tr>`;
  headerCells.forEach((cell, idx) => {
    const colAlign = alignments[idx] || (isPersian(cell) ? "right" : defaultAlign);
    out += `<th style="border: 1px solid #555; padding: 6px 10px; text-align: ${colAlign};">${cell}</th>`;
  });
  out += `</tr></thead><tbody>`;

  bodyRows.forEach((row, rowIdx) => {
    const bg = rowIdx % 2 === 1 ? "background-color: rgba(128, 128, 128, 0.08);" : "";
    out += `<tr style="${bg}">`;
    headerCells.forEach((_, idx) => {
      const cell = row[idx] || "";
      const colAlign = alignments[idx] || (isPersian(cell) ? "right" : defaultAlign);
      out += `<td style="border: 1px solid #555; padding: 6px 10px; text-align: ${colAlign};">${cell}</td>`;
    });
    out += `</tr>`;
  });

  out += `</tbody></table></div>`;
  return out;
}

export function markdownToMatrixHtml(md: string): string {
  const codeBlocks: string[] = [];
  let workingText = md.replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_match, lang, code) => {
      const idx = codeBlocks.length;
      const escapedCode = escapeHtml(code);
      codeBlocks.push(
        `<div dir="ltr" style="text-align: left;"><pre><code${
          lang ? ` class="language-${lang}"` : ""
        }>${escapedCode}</code></pre></div>`,
      );
      return `\uE000CB${idx}\uE001`;
    },
  );

  const inlineCodes: string[] = [];
  workingText = workingText.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code dir="ltr">${escapeHtml(code)}</code>`);
    return `\uE000IC${idx}\uE001`;
  });

  workingText = escapeHtml(workingText);

  // Headers: ###, ##, #
  workingText = workingText.replace(/^### (.*)$/gm, "<h4>$1</h4>");
  workingText = workingText.replace(/^## (.*)$/gm, "<h3>$1</h3>");
  workingText = workingText.replace(/^# (.*)$/gm, "<h2>$1</h2>");

  // Blockquotes: > quote
  workingText = workingText.replace(
    /^> (.*)$/gm,
    "<blockquote>$1</blockquote>",
  );

  // Markdown Tables & Bullet Lists: process line-by-line first so lists aren't mangled by italic regex
  const rawLines = workingText.split("\n");
  const processedBlocks: string[] = [];
  let currentTableLines: string[] = [];

  const flushTable = () => {
    if (currentTableLines.length > 0) {
      if (currentTableLines.length >= 2 && currentTableLines[0].includes("|") && currentTableLines[1].includes("|")) {
        processedBlocks.push(renderMarkdownTable(currentTableLines));
      } else {
        processedBlocks.push(...currentTableLines);
      }
      currentTableLines = [];
    }
  };

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 2) {
      currentTableLines.push(trimmed);
    } else {
      flushTable();
      if (/^[*-]\s+(.*)$/.test(trimmed)) {
        processedBlocks.push(trimmed.replace(/^[*-]\s+(.*)$/, "<li>$1</li>"));
      } else {
        processedBlocks.push(line);
      }
    }
  }
  flushTable();

  // Apply inline markdown formatting to lines (links, bold, italic, strikethrough)
  const links: string[] = [];
  const formattedBlocks = processedBlocks.map((line) => {
    if (line.startsWith("<div") || line.startsWith("<table")) return line;
    let l = line;
    // Markdown links: [title](url) (extract and protect first before italic/underscore rules)
    l = l.replace(
      /\[([^\]]+)\]\(((?:https?|file):\/\/[^\s)]+)\)/g,
      (_match, title, url) => {
        const idx = links.length;
        links.push(`<a href="${url}">${title}</a>`);
        return `\uE000LK${idx}\uE001`;
      },
    );
    // Bold: **text**
    l = l.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    // Italic: *text* or _text_ (single-line only, not crossing lines)
    l = l.replace(/(^|[^*])\*([^*\n\r]+)\*(?!\*)/g, "$1<em>$2</em>");
    l = l.replace(/(^|[^_])_([^_\n\r]+)_(?!_)/g, "$1<em>$2</em>");
    // Strikethrough: ~~text~~
    l = l.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    return l;
  });

  const processedLines = formattedBlocks.map((line) => {
    if (!line.trim()) return "<br/>";
    if (
      line.includes("\uE000CB") ||
      line.startsWith("<h2>") ||
      line.startsWith("<h3>") ||
      line.startsWith("<h4>") ||
      line.startsWith("<blockquote>") ||
      line.startsWith("<li>") ||
      line.startsWith("<div dir=") ||
      line.startsWith("<table")
    ) {
      return line;
    }
    const rtl = isPersian(line);
    const dir = rtl ? "rtl" : "ltr";
    const align = rtl ? "right" : "left";
    return `<div dir="${dir}" style="text-align: ${align};">${line}</div>`;
  });

  let html = processedLines.join("");

  // Wrap consecutive list items in <ul>
  html = html.replace(/(<li>.*?<\/li>)+/g, (match) => `<ul>${match}</ul>`);

  links.forEach((link, idx) => {
    html = html.replace(`\uE000LK${idx}\uE001`, link);
  });
  inlineCodes.forEach((code, idx) => {
    html = html.replace(`\uE000IC${idx}\uE001`, code);
  });
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`\uE000CB${idx}\uE001`, block);
  });

  return html;
}
