import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../stores/documentStore";
import { useAiStore } from "../stores/aiStore";
import ReactMarkdown from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "./Toast";

export default function AiSidebar() {
  const { currentDocument, currentPage, setCurrentPage } = useDocumentStore();
  const { messages, isGenerating, streamingContent, runWorkflow, cancelWorkflow, retryLastWorkflow, lastWorkflowInput } = useAiStore();
  const [input, setInput] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [savedNotes, setSavedNotes] = useState<Set<string>>(new Set());
  const [showRange, setShowRange] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const threshold = 50;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleExplain = useCallback(async () => {
    if (!currentDocument) return;
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return;
    try {
      await runWorkflow({
        documentId: currentDocument.id,
        documentTitle: currentDocument.title ?? undefined,
        mode: "selection_explain",
        pageNumber: currentPage,
        selectedText: sel,
      });
    } catch (err) {
      addToast({ type: "error", message: `AI explanation failed: ${err}` });
    }
  }, [currentDocument, currentPage, runWorkflow, addToast]);

  const handleSummarizePage = useCallback(async () => {
    if (!currentDocument) return;
    try {
      await runWorkflow({
        documentId: currentDocument.id,
        documentTitle: currentDocument.title ?? undefined,
        mode: "page_summary",
        pageNumber: currentPage,
      });
    } catch (err) {
      addToast({ type: "error", message: `AI summarization failed: ${err}` });
    }
  }, [currentDocument, currentPage, runWorkflow, addToast]);

  const handleSummarizeRange = useCallback(async () => {
    if (!currentDocument || !rangeStart || !rangeEnd) return;
    try {
      await runWorkflow({
        documentId: currentDocument.id,
        documentTitle: currentDocument.title ?? undefined,
        mode: "range_summary",
        pageNumber: currentPage,
        startPage: parseInt(rangeStart),
        endPage: parseInt(rangeEnd),
      });
    } catch (err) {
      addToast({ type: "error", message: `AI range summarization failed: ${err}` });
    }
  }, [currentDocument, currentPage, rangeStart, rangeEnd, runWorkflow, addToast]);

  const handleAskQuestion = useCallback(async () => {
    if (!currentDocument || !input.trim()) return;
    const question = input.trim();
    setInput("");
    try {
      await runWorkflow({
        documentId: currentDocument.id,
        documentTitle: currentDocument.title ?? undefined,
        mode: "chapter_qa",
        pageNumber: currentPage,
        question,
      });
    } catch (err) {
      addToast({ type: "error", message: `AI request failed: ${err}` });
    }
  }, [currentDocument, currentPage, input, runWorkflow, addToast]);

  // Save AI answer as note
  const handleSaveAsNote = useCallback(
    async (msg: typeof messages[0]) => {
      if (!currentDocument || savedNotes.has(msg.id)) return;
      try {
        await invoke("create_annotation", {
          input: {
            document_id: currentDocument.id,
            page_number: msg.page_number ?? currentPage,
            type: "ai_note",
            note_text: msg.content,
            selected_text: null,
          },
        });
        setSavedNotes((prev) => new Set(prev).add(msg.id));
      } catch (err) {
        addToast({ type: "error", message: "Failed to save note." });
      }
    },
    [currentDocument, currentPage, savedNotes],
  );

  // Handle citation click
  const handleCitationClick = useCallback(
    (e: React.MouseEvent, pageNumber: number) => {
      e.preventDefault();
      setCurrentPage(pageNumber);
      invoke("update_last_page", {
        documentId: currentDocument?.id,
        pageNumber,
      }).catch(() => {});
    },
    [currentDocument?.id, setCurrentPage],
  );

  // Custom markdown renderer for citation links
  const renderers = useCallback(
    (_msg: typeof messages[0]) => ({
      p: ({ children }: any) => {
        const text = extractText(children);
        if (!text) return <p>{children}</p>;
        const parts = text.split(/(\[p\.?\s*\d+\])/gi);
        if (parts.length === 1) return <p>{children}</p>;

        return (
          <p>
            {parts.map((part: string, i: number) => {
              const match = part.match(/\[p\.?\s*(\d+)\]/i);
              if (match) {
                const page = parseInt(match[1], 10);
                return (
                  <a
                    key={i}
                    href="#"
                    onClick={(e) => handleCitationClick(e, page)}
                    style={{
                      color: "var(--accent-color)",
                      fontWeight: 600,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    [p.{page}]
                  </a>
                );
              }
              return <span key={i}>{part}</span>;
            })}
          </p>
        );
      },
    }),
    [handleCitationClick],
  );

  if (!currentDocument) {
    return (
      <div className="sidebar-inner">
        <div className="ai-header">AI Assistant</div>
        <div className="ai-content">
          <p>Open a PDF to start reading with AI assistance.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-inner">
      {/* Compact header with actions */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "6px 10px", borderBottom: "1px solid var(--border-color)",
        fontSize: 13, fontWeight: 600, flexShrink: 0,
      }}>
        <span style={{ marginRight: "auto" }}>AI</span>
        <button onClick={handleSummarizePage} disabled={isGenerating}
          style={{ padding: "2px 6px", fontSize: 11, background: "var(--accent-color)", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 500 }}>
          Summarize
        </button>
        <button onClick={() => setShowRange(!showRange)}
          style={{ padding: "2px 6px", fontSize: 11, background: showRange ? "var(--accent-color)" : "var(--bg-tertiary)", color: showRange ? "#fff" : "var(--text-secondary)", border: "none", borderRadius: 3, cursor: "pointer" }}>
          Range
        </button>
        <button onClick={() => window.getSelection()?.toString().trim() ? handleExplain() : null}
          disabled={isGenerating}
          style={{ padding: "2px 6px", fontSize: 11, background: "var(--success-color)", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 500 }}>
          Explain
        </button>
        {lastWorkflowInput && !isGenerating && (
          <button onClick={() => retryLastWorkflow().catch((err) => addToast({ type: "error", message: `AI retry failed: ${err}` }))}
            style={{ padding: "2px 6px", fontSize: 11, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)", borderRadius: 3, cursor: "pointer" }}>
            ↻ Retry
          </button>
        )}
      </div>

      {/* Page range (collapsible) */}
      {showRange && (
        <div style={{
          display: "flex", alignItems: "center", gap: 3,
          padding: "4px 10px", borderBottom: "1px solid var(--border-color)",
          fontSize: 12, flexShrink: 0,
        }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>From</span>
          <input type="number" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} placeholder="1"
            style={{ width: 40, padding: "2px 4px", border: "1px solid var(--border-color)", borderRadius: 3, fontSize: 11, background: "var(--bg-primary)", color: "var(--text-primary)" }} />
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>to</span>
          <input type="number" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} placeholder="1"
            style={{ width: 40, padding: "2px 4px", border: "1px solid var(--border-color)", borderRadius: 3, fontSize: 11, background: "var(--bg-primary)", color: "var(--text-primary)" }} />
          <button onClick={handleSummarizeRange} disabled={isGenerating || !rangeStart || !rangeEnd}
            style={{ padding: "2px 6px", fontSize: 11, background: "var(--accent-color)", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>
            Go
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} role="log" aria-live="polite" aria-label="AI conversation" style={{ flex: 1, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, marginTop: 16, lineHeight: 1.6 }}>
            <p>AI answers appear here.</p>
            <p>Select text and press <strong>E</strong> to explain,<br />or click Summarize.</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} style={{
            padding: "6px 8px", borderRadius: 4,
            background: msg.role === "user" ? "var(--bg-secondary)" : "var(--bg-primary)",
            border: "1px solid var(--border-color)", fontSize: 12, lineHeight: 1.5,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {msg.role === "user" ? "You" : "AI"}
            </div>
            {msg.role === "assistant" ? (
              <div className="markdown-content">
                <ReactMarkdown components={renderers(msg)}>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <div>{msg.content}</div>
            )}
            {msg.role === "assistant" && (
              <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                <button onClick={() => handleSaveAsNote(msg)} disabled={savedNotes.has(msg.id)}
                  style={{ padding: "2px 6px", fontSize: 10, background: "transparent", color: savedNotes.has(msg.id) ? "var(--text-muted)" : "var(--accent-color)", border: `1px solid ${savedNotes.has(msg.id) ? "var(--border-color)" : "var(--accent-color)"}`, borderRadius: 3, cursor: "pointer" }}>
                  {savedNotes.has(msg.id) ? "✓ Saved" : "Save"}
                </button>
              </div>
            )}
            {import.meta.env.DEV && msg.context_snapshot_json && (
              <details style={{ marginTop: 4, fontSize: 10, color: "var(--text-muted)" }}>
                <summary style={{ cursor: "pointer" }}>Context</summary>
                <pre style={{ marginTop: 2, padding: 4, background: "var(--bg-tertiary)", borderRadius: 3, maxHeight: 120, overflow: "auto", fontSize: 10 }}>
                  {JSON.stringify(JSON.parse(msg.context_snapshot_json), null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
        {isGenerating && streamingContent && (
          <div style={{
            padding: "6px 8px", borderRadius: 4,
            background: "var(--bg-primary)",
            border: "1px solid var(--border-color)", fontSize: 12, lineHeight: 1.5,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                AI
              </span>
              <button onClick={cancelWorkflow} title="Cancel"
                style={{ marginLeft: "auto", padding: "1px 5px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border-color)", borderRadius: 3, fontSize: 10, cursor: "pointer" }}>
                ✕
              </button>
            </div>
            <div className="markdown-content">
              <ReactMarkdown>{streamingContent}</ReactMarkdown>
            </div>
          </div>
        )}
        {isGenerating && !streamingContent && (
          <div style={{ padding: "8px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            <span>Thinking…</span>
            <button onClick={cancelWorkflow} title="Cancel"
              style={{ marginLeft: 8, padding: "2px 6px", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border-color)", borderRadius: 3, fontSize: 11, cursor: "pointer" }}>
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{
        display: "flex", gap: 4, padding: "6px 10px",
        borderTop: "1px solid var(--border-color)", flexShrink: 0,
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleAskQuestion();
            }
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = el.scrollHeight + "px";
          }}
          placeholder="Ask about this page…"
          disabled={isGenerating}
          rows={1}
          style={{
            flex: 1, padding: "5px 8px", border: "1px solid var(--border-color)",
            borderRadius: 4, fontSize: 12, background: "var(--bg-primary)", color: "var(--text-primary)",
            resize: "none", overflow: "hidden", lineHeight: 1.4, fontFamily: "inherit",
          }}
        />
        <button onClick={handleAskQuestion} disabled={isGenerating || !input.trim()} title="Ask"
          style={{ padding: "5px 10px", background: "var(--accent-color)", color: "#fff", border: "none", borderRadius: 4, fontSize: 15, lineHeight: 1, cursor: "pointer" }}>
          ▶
        </button>
      </div>
    </div>
  );
}

// Helper to extract text from React children
function extractText(children: any): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children))
    return children.map(extractText).join("");
  if (children?.props?.children) return extractText(children.props.children);
  return "";
}
