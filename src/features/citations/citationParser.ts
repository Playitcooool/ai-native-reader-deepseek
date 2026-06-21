// Parse [p.X] citation references from AI responses
// Handles: [p.12], [p. 12], [p 12]
const CITATION_REGEX = /\[p\.?\s*(\d+)\]/gi;

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
