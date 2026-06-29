import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { linkCitationMarkdown } from "../features/citations/citationParser";

interface AiMarkdownProps {
  children: string;
  onPageLink?: (pageNumber: number) => void;
}

export default function AiMarkdown({ children, onPageLink }: AiMarkdownProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("ai-page://")) {
              const page = Number(href.slice("ai-page://".length));
              return (
                <a
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (Number.isFinite(page)) onPageLink?.(page);
                  }}
                >
                  {children}
                </a>
              );
            }
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
          },
        }}
      >
        {linkCitationMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}
