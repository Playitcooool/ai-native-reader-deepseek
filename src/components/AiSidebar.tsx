import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { documentDisplayTitle, useDocumentStore } from "../stores/documentStore";
import { type AiMessage, useAiStore } from "../stores/aiStore";
import { useUndoStore } from "../stores/undoStore";
import { inferAskScope } from "../features/ai/promptScope";
import { draftFromSelection, shouldFollowScroll } from "../features/ai/aiPanelHelpers";
import { useToast } from "./Toast";
import AiMarkdown from "./AiMarkdown";

interface AiSidebarProps {
  draftInput?: string;
  onDraftConsumed?: () => void;
}

export default function AiSidebar({ draftInput, onDraftConsumed }: AiSidebarProps) {
  const { currentDocument, currentPage, setCurrentPage, tocNodes } = useDocumentStore();
  const { messages, isGenerating, aiPhase, streamingContent, runWorkflow, cancelWorkflow, retryLastWorkflow, lastWorkflowInput } = useAiStore();
  const pushUndo = useUndoStore((s) => s.pushUndo);
  const [input, setInput] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [savedNotes, setSavedNotes] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState("");
  const [showRange, setShowRange] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [showJump, setShowJump] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followScrollRef = useRef(true);
  const { addToast } = useToast();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!draftInput) return;
    setInput(draftInput);
    inputRef.current?.focus();
    onDraftConsumed?.();
  }, [draftInput, onDraftConsumed]);

  useEffect(() => {
    const updateSelection = () => setSelectedText(window.getSelection()?.toString().trim() ?? "");
    document.addEventListener("selectionchange", updateSelection);
    updateSelection();
    return () => document.removeEventListener("selectionchange", updateSelection);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (followScrollRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    } else {
      setShowJump(true);
    }
  }, [messages, streamingContent]);

  const maxPage = currentDocument?.page_count ?? 0;
  const parsedRange = useMemo(() => {
    const start = Number(rangeStart);
    const end = Number(rangeEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) return null;
    if (maxPage && (start > maxPage || end > maxPage)) return null;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }, [rangeStart, rangeEnd, maxPage]);

  const runSafely = useCallback(async (fn: () => Promise<void>, label: string) => {
    try {
      await fn();
    } catch (err) {
      addToast({ type: "error", message: `${label}: ${err}` });
    }
  }, [addToast]);

  const handleSummarizePage = useCallback(() => runSafely(async () => {
    if (!currentDocument) return;
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: documentDisplayTitle(currentDocument),
      mode: "page_summary",
      pageNumber: currentPage,
      pageCount: currentDocument.page_count,
    });
  }, "AI summarization failed"), [currentDocument, currentPage, runWorkflow, runSafely]);

  const handleSummarizeDocument = useCallback(() => runSafely(async () => {
    if (!currentDocument?.page_count) return;
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: documentDisplayTitle(currentDocument),
      mode: "range_summary",
      pageNumber: currentPage,
      pageCount: currentDocument.page_count,
      startPage: 1,
      endPage: currentDocument.page_count,
    });
  }, "AI document summarization failed"), [currentDocument, currentPage, runWorkflow, runSafely]);

  const handleSummarizeRange = useCallback(() => runSafely(async () => {
    if (!currentDocument || !parsedRange) return;
    setRangeStart(String(parsedRange.start));
    setRangeEnd(String(parsedRange.end));
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: documentDisplayTitle(currentDocument),
      mode: "range_summary",
      pageNumber: currentPage,
      pageCount: currentDocument.page_count,
      startPage: parsedRange.start,
      endPage: parsedRange.end,
    });
  }, "AI range summarization failed"), [currentDocument, currentPage, parsedRange, runWorkflow, runSafely]);

  const handleAskQuestion = useCallback(() => runSafely(async () => {
    if (!currentDocument || !input.trim()) return;
    const question = input.trim();
    setInput("");
    const scope = inferAskScope(question, currentPage, tocNodes, currentDocument.page_count ?? 0);
    const pageCount = currentDocument.page_count ?? 0;
    if (scope.kind === "range" && pageCount > 0 && (scope.startPage < 1 || scope.endPage > pageCount)) {
      throw new Error(`Requested pages ${scope.startPage}-${scope.endPage}, but this document has ${pageCount} pages.`);
    }
    if (scope.kind === "pages" && pageCount > 0) {
      const badPage = scope.pages.find((page) => page < 1 || page > pageCount);
      if (badPage) throw new Error(`Requested page ${badPage}, but this document has ${pageCount} pages.`);
    }
    const startPage = scope.kind === "range" || scope.kind === "section" ? scope.startPage : undefined;
    const endPage = scope.kind === "range" || scope.kind === "section" ? scope.endPage : undefined;
    const pageNumbers = scope.kind === "pages" ? scope.pages : undefined;
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: documentDisplayTitle(currentDocument),
      mode: scope.kind === "pages" ? "pages_qa" : scope.kind === "range" ? "range_qa" : "chapter_qa",
      pageNumber: pageNumbers?.[0] ?? startPage ?? currentPage,
      pageCount: currentDocument.page_count,
      startPage,
      endPage,
      pageNumbers,
      tocNodeId: scope.kind === "section" ? scope.node.id : undefined,
      question,
    });
  }, "AI request failed"), [currentDocument, currentPage, input, tocNodes, runWorkflow, runSafely]);

  const handleSaveAsNote = useCallback(async (msg: AiMessage) => {
    if (!currentDocument || savedNotes.has(msg.id)) return;
    try {
      const annotation = await invoke<{ id: string }>("create_annotation", {
        input: {
          document_id: currentDocument.id,
          page_number: msg.page_number ?? currentPage,
          type: "ai_note",
          note_text: msg.content,
          selected_text: null,
        },
      });
      pushUndo({
        label: "AI note",
        undo: async () => { await invoke("delete_annotation", { annotationId: annotation.id }); },
      });
      window.dispatchEvent(new Event("annotations-changed"));
      setSavedNotes((prev) => new Set(prev).add(msg.id));
      setFeedback("Saved");
    } catch {
      addToast({ type: "error", message: "Failed to save note." });
    }
  }, [currentDocument, currentPage, savedNotes, pushUndo, addToast]);

  const copyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setFeedback("Copied");
    } catch {
      addToast({ type: "error", message: "Clipboard copy failed." });
    }
  }, [addToast]);

  const handleContinue = useCallback((msg: AiMessage) => runSafely(async () => {
    if (!currentDocument || isGenerating) return;
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: documentDisplayTitle(currentDocument),
      mode: "chapter_qa",
      pageNumber: msg.page_number ?? currentPage,
      pageCount: currentDocument.page_count,
      question: "Continue from where you left off. Don't repeat what you already said.",
    });
  }, "Continue failed"), [currentDocument, currentPage, isGenerating, runWorkflow, runSafely]);

  const jumpToPage = useCallback((pageNumber: number) => {
    setCurrentPage(pageNumber);
    if (currentDocument?.id) {
      invoke("update_last_page", { documentId: currentDocument.id, pageNumber }).catch(() => {});
    }
  }, [currentDocument?.id, setCurrentPage]);

  const jumpToLatest = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    followScrollRef.current = true;
    setShowJump(false);
  }, []);

  const toggleRange = useCallback(() => {
    setShowRange((open) => {
      if (!open) {
        setRangeStart((value) => value || String(currentPage));
        setRangeEnd((value) => value || String(currentPage));
      }
      return !open;
    });
  }, [currentPage]);

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

  const contextStatus = lastWorkflowInput ? `${modeLabel(lastWorkflowInput.mode)} · ${phaseLabel(aiPhase)}` : "";

  return (
    <div className="sidebar-inner">
      <div className="ai-toolbar">
        <span className="ai-title">AI</span>
        <button className="ai-primary-button" onClick={handleSummarizePage} disabled={isGenerating}>Page</button>
        <button className="ai-ghost-button" onClick={handleSummarizeDocument} disabled={isGenerating || !currentDocument.page_count}>Paper</button>
        <button className={showRange ? "ai-primary-button" : "ai-ghost-button"} onClick={toggleRange}>Range</button>
        {selectedText && (
          <button className="ai-ghost-button" onMouseDown={(e) => e.preventDefault()} onClick={() => setInput(draftFromSelection(selectedText))} disabled={isGenerating}>
            Ask Selection
          </button>
        )}
        {lastWorkflowInput && !isGenerating && (
          <button className="ai-ghost-button" onClick={() => retryLastWorkflow().catch((err) => addToast({ type: "error", message: `AI retry failed: ${err}` }))}>
            Retry
          </button>
        )}
      </div>

      {showRange && (
        <div className="ai-range">
          <label>From <input type="number" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} min={1} max={maxPage || undefined} placeholder="1" /></label>
          <label>To <input type="number" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} min={1} max={maxPage || undefined} placeholder={String(maxPage || 1)} /></label>
          <button className="ai-primary-button" onClick={handleSummarizeRange} disabled={isGenerating || !parsedRange}>Go</button>
        </div>
      )}

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="AI conversation"
        className="ai-log"
        onScroll={(event) => {
          const el = event.currentTarget;
          followScrollRef.current = shouldFollowScroll(el.scrollTop, el.clientHeight, el.scrollHeight);
          if (followScrollRef.current) setShowJump(false);
        }}
      >
        {messages.map((msg) => (
          <article key={msg.id} className={`ai-message ai-message-${msg.role}`} tabIndex={0}>
            <div className="ai-message-label">{msg.role === "user" ? "You" : "AI"}</div>
            {msg.role === "assistant" ? <AiMarkdown onPageLink={jumpToPage}>{msg.content}</AiMarkdown> : <div className="ai-user-text">{msg.content}</div>}
            {msg.role === "assistant" && contextWarnings(msg).length > 0 && (
              <div className="ai-context-warning">Context: {contextWarnings(msg).join(" ")}</div>
            )}
            {msg.role === "assistant" && (
              <div className="ai-message-actions">
                <button onClick={() => copyMessage(msg.content)}>Copy</button>
                <button onClick={() => handleSaveAsNote(msg)} disabled={savedNotes.has(msg.id)}>{savedNotes.has(msg.id) ? "Saved" : "Save note"}</button>
                <button onClick={() => handleContinue(msg)} disabled={isGenerating}>Continue</button>
              </div>
            )}
            {import.meta.env.DEV && msg.context_snapshot_json && (
              <details className="ai-dev-context">
                <summary>Context</summary>
                <pre>{JSON.stringify(JSON.parse(msg.context_snapshot_json), null, 2)}</pre>
              </details>
            )}
          </article>
        ))}
        {isGenerating && streamingContent && (
          <article className="ai-message ai-message-assistant">
            <div className="ai-stream-header">
              <span className="ai-message-label">AI</span>
              <button onClick={cancelWorkflow} title="Cancel">Cancel</button>
            </div>
            <AiMarkdown onPageLink={jumpToPage}>{streamingContent}</AiMarkdown>
          </article>
        )}
        {isGenerating && !streamingContent && (
          <div className="ai-thinking">
            <span>{contextStatus || "Thinking"}</span>
            <span aria-hidden="true" className="ai-thinking-dots"><span /> <span /> <span /></span>
            <button onClick={cancelWorkflow} title="Cancel">Cancel</button>
          </div>
        )}
      </div>

      {showJump && <button className="ai-jump-latest" onClick={jumpToLatest}>Jump to latest</button>}
      {feedback && <div className="ai-feedback" role="status" onAnimationEnd={() => setFeedback("")}>{feedback}</div>}

      <div className="ai-composer">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
              e.preventDefault();
              handleAskQuestion();
            }
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          placeholder="Ask about this page..."
          disabled={isGenerating}
          rows={1}
        />
        <button className="ai-send" onClick={handleAskQuestion} disabled={isGenerating || !input.trim()} title="Ask" aria-label="Ask">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4.5 21 12 4 19.5v-6l9-1.5-9-1.5v-6Z" /></svg>
        </button>
      </div>
    </div>
  );
}

function modeLabel(mode: string): string {
  if (mode === "page_summary") return "page";
  if (mode === "range_summary") return "range";
  if (mode === "pages_qa") return "pages";
  if (mode === "selection_explain") return "selection";
  return "question";
}

function phaseLabel(aiPhase: string): string {
  if (aiPhase.startsWith("ocr:")) return `OCR page ${aiPhase.split(":")[1]}`;
  if (aiPhase.startsWith("waiting_for_text:")) return `extracting page ${aiPhase.split(":")[1]}`;
  if (aiPhase === "building_context") return "building context";
  if (aiPhase === "calling_ai") return "Thinking";
  return "Thinking";
}

function contextWarnings(msg: AiMessage): string[] {
  if (!msg.context_snapshot_json) return [];
  try {
    const warnings = JSON.parse(msg.context_snapshot_json)?.warnings;
    return Array.isArray(warnings) ? warnings.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
}
