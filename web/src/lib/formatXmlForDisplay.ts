/** Exibe XML de NF-e com indentação no painel (sheet de desenvolvimento). */

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function prettyPrintXmlFallback(xml: string): string {
  const pad = "  ";
  const normalized = xml.replace(/>\s+</g, ">\n<");
  const lines: string[] = [];
  let indent = 0;

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^<\//.test(line)) indent = Math.max(0, indent - 1);
    lines.push(pad.repeat(indent) + line);
    const isSelfClosing = /\/>$/.test(line);
    const isClosingInline = /^<[^>]+\/.+>$/.test(line);
    const isOpening =
      /^<[^!?/]/.test(line) && !isSelfClosing && !/^<\?/.test(line);
    if (isOpening && !isClosingInline && !/<\/[^>]+>$/.test(line)) {
      indent += 1;
    }
  }

  return lines.join("\n");
}

function walkElement(el: Element, depth: number, lines: string[]): void {
  const pad = "  ".repeat(depth);
  const attrs = [...el.attributes]
    .map((a) => ` ${a.name}="${escapeXmlAttr(a.value)}"`)
    .join("");

  const elementChildren = [...el.childNodes].filter(
    (n): n is Element => n.nodeType === Node.ELEMENT_NODE,
  );
  const text = [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();

  if (elementChildren.length === 0) {
    if (text) {
      lines.push(
        `${pad}<${el.tagName}${attrs}>${escapeXmlText(text)}</${el.tagName}>`,
      );
    } else {
      lines.push(`${pad}<${el.tagName}${attrs}/>`);
    }
    return;
  }

  lines.push(`${pad}<${el.tagName}${attrs}>`);
  if (text) lines.push(`${pad}  ${escapeXmlText(text)}`);
  for (const child of elementChildren) {
    walkElement(child, depth + 1, lines);
  }
  lines.push(`${pad}</${el.tagName}>`);
}

/**
 * Formata XML para leitura humana (2 espaços por nível).
 * Se o parse falhar, usa fallback por linhas.
 */
export function formatXmlForDisplay(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  if (!text.startsWith("<")) return text;

  try {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      return prettyPrintXmlFallback(text);
    }

    const root = doc.documentElement;
    if (!root) return prettyPrintXmlFallback(text);

    const lines: string[] = [];
    const decl = text.match(/^<\?xml[^?]*\?>/i);
    if (decl) lines.push(decl[0]);

    walkElement(root, 0, lines);
    return lines.join("\n");
  } catch {
    return prettyPrintXmlFallback(text);
  }
}
