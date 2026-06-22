import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../stores/documentStore";
import { type AiMessage, useAiStore } from "../stores/aiStore";
import ReactMarkdown from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "./Toast";

const line = "1px solid var(--border-color)";
const tinyButton: CSSProperties = { padding: "2px 6px", borderRadius: 3, fontSize: 11, cursor: "pointer" };
const ghostButton: CSSProperties = { ...tinyButton, background: "transparent", color: "var(--text-secondary)", border: line };
const messageStyle: CSSProperties = {
  padding: "6px 8px",
  borderRadius: 4,
  background: "var(--bg-primary)",
  border: line,
  fontSize: 12,
  lineHeight: 1.5,
};
const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

function primaryButton(bg = "var(--accent-color)"): CSSProperties {
  return { ...tinyButton, background: bg, color: "#fff", border: "none", fontWeight: 500 };
}

export default function AiSidebar() {
  const { currentDocument, currentPage, setCurrentPage } = useDocumentStore();
  const { messages, isGenerating, aiPhase, streamingContent, runWorkflow, cancelWorkflow, retryLastWorkflow, lastWorkflowInput } = useAiStore();
  const setSessionId = useAiStore((s) => s.setSessionId);
  const setMessages = useAiStore((s) => s.setMessages);

  // Reset AI session when switching documents to prevent context leak
  useEffect(() => {
    setSessionId(null);
    setMessages([]);
  }, [currentDocument?.id, setSessionId, setMessages]);
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
    let sp = Math.max(1, Math.min(parseInt(rangeStart) || 1, currentDocument.page_count ?? 9999));
    let ep = Math.max(1, Math.min(parseInt(rangeEnd) || 1, currentDocument.page_count ?? 9999));
    if (sp > ep) [sp, ep] = [ep, sp];
    setRangeStart(String(sp));
    setRangeEnd(String(ep));
    try {
      await runWorkflow({
        documentId: currentDocument.id,
        documentTitle: currentDocument.title ?? undefined,
        mode: "range_summary",
        pageNumber: currentPage,
        startPage: sp,
        endPage: ep,
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

  const handleSaveAsNote = useCallback(
    async (msg: AiMessage) => {
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
    [currentDocument, currentPage, savedNotes, addToast],
  );

  const handleContinue = useCallback(
    async (msg: AiMessage) => {
      if (!currentDocument || isGenerating) return;
      try {
        await runWorkflow({
          documentId: currentDocument.id,
          documentTitle: currentDocument.title ?? undefined,
          mode: "chapter_qa",
          pageNumber: msg.page_number ?? currentPage,
          question: "Continue from where you left off. Don't repeat what you already said.",
        });
      } catch (err) {
        addToast({ type: "error", message: `Continue failed: ${err}` });
      }
    },
    [currentDocument, currentPage, isGenerating, runWorkflow, addToast],
  );

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

  const citationRenderers = useCallback(
    () => ({
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

  const contextStatus = lastWorkflowInput
    ? `p.${lastWorkflowInput.pageNumber} · ${modeLabel(lastWorkflowInput.mode)} · ${
        aiPhase === "waiting_for_text" ? "waiting for text/OCR" :
        aiPhase === "building_context" ? "building context" :
        aiPhase === "calling_ai" ? "querying AI" :
        "thinking"
      }`
    : "";

  return (
    <div className="sidebar-inner">
      <div className="ai-toolbar">
        <span className="ai-title">AI</span>
        <button onClick={handleSummarizePage} disabled={isGenerating}
          style={primaryButton()}>
          Summarize
        </button>
        <button onClick={() => setShowRange(!showRange)}
          style={showRange ? primaryButton() : { ...ghostButton, background: "var(--bg-tertiary)", border: "none" }}>
          Range
        </button>
        <button onClick={() => window.getSelection()?.toString().trim() ? handleExplain() : null}
          disabled={isGenerating}
          style={primaryButton("var(--success-color)")}>
          Explain
        </button>
        {lastWorkflowInput && !isGenerating && (
          <button onClick={() => retryLastWorkflow().catch((err) => addToast({ type: "error", message: `AI retry failed: ${err}` }))}
            style={ghostButton}>
            ↻ Retry
          </button>
        )}
      </div>

      {showRange && (
        <div className="ai-range">
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>From</span>
          <input type="number" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} placeholder="1" min={1} max={currentDocument?.page_count ?? 9999}
            style={{ width: 40, padding: "2px 4px", border: line, borderRadius: 3, fontSize: 11, background: "var(--bg-primary)", color: "var(--text-primary)" }} />
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>to</span>
          <input type="number" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} placeholder="1" min={1} max={currentDocument?.page_count ?? 9999}
            style={{ width: 40, padding: "2px 4px", border: line, borderRadius: 3, fontSize: 11, background: "var(--bg-primary)", color: "var(--text-primary)" }} />
          <button onClick={handleSummarizeRange} disabled={isGenerating || !rangeStart || !rangeEnd}
            style={primaryButton()}>
            Go
          </button>
        </div>
      )}

      <div ref={listRef} role="log" aria-live="polite" aria-label="AI conversation" className="ai-log">
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, marginTop: 16, lineHeight: 1.6 }}>
            <p>AI answers appear here.</p>
            <p>Select text and press <strong>E</strong> to explain,<br />or click Summarize.</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} style={{ ...messageStyle, background: msg.role === "user" ? "var(--bg-secondary)" : "var(--bg-primary)" }}>
            <div style={{ ...labelStyle, marginBottom: 2 }}>
              {msg.role === "user" ? "You" : "AI"}
            </div>
            {msg.role === "assistant" ? (
              <div className="markdown-content">
                <ReactMarkdown components={citationRenderers()}>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <div>{msg.content}</div>
            )}
            {msg.role === "assistant" && (
              <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                <button onClick={() => navigator.clipboard.writeText(msg.content)}
                  title="Copy"
                  style={{ ...ghostButton, fontSize: 12, lineHeight: 1, color: "var(--text-muted)" }}>
                  📋
                </button>
                <button onClick={() => handleSaveAsNote(msg)} disabled={savedNotes.has(msg.id)}
                  style={{ ...ghostButton, fontSize: 10, color: savedNotes.has(msg.id) ? "var(--text-muted)" : "var(--accent-color)", borderColor: savedNotes.has(msg.id) ? "var(--border-color)" : "var(--accent-color)" }}>
                  {savedNotes.has(msg.id) ? "✓ Saved" : "Save"}
                </button>
                <button onClick={() => handleContinue(msg)} disabled={isGenerating}
                  style={{ ...ghostButton, fontSize: 10 }}>
                  Continue
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
          <div style={messageStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
              <span style={labelStyle}>
                AI
              </span>
              <button onClick={cancelWorkflow} title="Cancel"
                style={{ ...ghostButton, marginLeft: "auto", padding: "1px 5px", fontSize: 10, color: "var(--text-muted)" }}>
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
            <span>{contextStatus || "Thinking..."}</span>
            <button onClick={cancelWorkflow} title="Cancel"
              style={{ ...ghostButton, marginLeft: 8, color: "var(--text-muted)" }}>
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="ai-composer">
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
            flex: 1, padding: "5px 8px", border: line,
            borderRadius: 4, fontSize: 12, background: "var(--bg-primary)", color: "var(--text-primary)",
            resize: "none", overflow: "hidden", lineHeight: 1.4, fontFamily: "inherit",
          }}
        />
        <button className="ai-send" onClick={handleAskQuestion} disabled={isGenerating || !input.trim()} title="Ask" aria-label="Ask">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4.5 21 12 4 19.5v-6l9-1.5-9-1.5v-6Z" /></svg>
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

function modeLabel(mode: string): string {
  if (mode === "page_summary") return "page";
  if (mode === "range_summary") return "range";
  if (mode === "selection_explain") return "selection";
  return "question";
}
