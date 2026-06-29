// Parse [p.X] citation references from AI responses
// Handles: [p.12], [p. 12], [p 12]
const CITATION_REGEX = /\[p\.?\s*(\d+)\]/gi;
const CITATION_AT_START_REGEX = /^\[p\.?\s*(\d+)\]/i;

export interface CitationRef {
  pageNumber: number;
  match: string;
}

export function parseCitations(text: string): CitationRef[] {
  const refs: CitationRef[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(CITATION_REGEX.source, 'gi');
  while ((match = regex.exec(text)) !== null) {
    refs.push({
      pageNumber: parseInt(match[1], 10),
      match: match[0],
    });
  }
  return refs;
}

export function linkCitationMarkdown(markdown: string): string {
  let inFence = false;
  let inMathFence = false;

  return markdown
    .split(/(\n)/)
    .map((part) => {
      if (part === "\n") return part;
      if (/^\s*(```|~~~)/.test(part)) {
        inFence = !inFence;
        return part;
      }
      if (/^\s*\$\$\s*$/.test(part)) {
        inMathFence = !inMathFence;
        return part;
      }
      return inFence || inMathFence ? part : linkCitationLine(part);
    })
    .join("");
}

function linkCitationLine(line: string): string {
  let out = "";
  for (let i = 0; i < line.length;) {
    const char = line[i];
    if (char === "`") {
      const end = line.indexOf("`", i + 1);
      const next = end === -1 ? line.length : end + 1;
      out += line.slice(i, next);
      i = next;
      continue;
    }
    if (char === "$") {
      const marker = line[i + 1] === "$" ? "$$" : "$";
      const end = line.indexOf(marker, i + marker.length);
      const next = end === -1 ? line.length : end + marker.length;
      out += line.slice(i, next);
      i = next;
      continue;
    }
    const match = line.slice(i).match(CITATION_AT_START_REGEX);
    if (match) {
      out += `${match[0]}(ai-page://${match[1]})`;
      i += match[0].length;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}
