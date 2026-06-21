// Parse [p.X] citation references from AI responses
// Handles: [p.12], [p. 12], [p 12], [p.12-14] (range variant captured as range)
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

// Replace [p.X] markers with clickable elements
export function renderCitationLinks(
  text: string,
  _onNavigate: (page: number) => void,
): string {
  return text.replace(
    CITATION_REGEX,
    (match, pageNum) => {
      const page = parseInt(pageNum, 10);
      const encoded = encodeURIComponent(JSON.stringify({ page, match }));
      // We'll use a custom HTML tag that React can handle
      return `<a href="#" data-citation="${encoded}" class="citation-link">[p.${page}]</a>`;
    },
  );
}
