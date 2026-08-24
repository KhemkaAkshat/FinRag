"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const STORAGE_KEY = "finrag-conversations";
const LEGACY_KEY = "finrag-chat-history";
const starters = ["What are Apple's main products and services?", "Summarize the key risks in the latest filing.", "How did revenue change compared with the prior period?"];
const activeIngestionStatuses = new Set(["QUEUED", "RUNNING", "DOWNLOADING", "INDEXING", "UPDATING_BM25"]);

function makeConversation(messages = [], title = "New research thread") { return { id: crypto.randomUUID(), title, messages, updatedAt: Date.now() }; }
function AccountControl() { return clerkEnabled ? <UserButton /> : <Link href="/" className="local-account">Local mode</Link>; }

function SourceCard({ source, index }) {
  const label = [source.company, source.ticker && `(${source.ticker})`].filter(Boolean).join(" ") || `SEC filing ${index + 1}`;
  return <article className="chat-source"><div className="source-number">0{index + 1}</div><div><strong>{label}</strong><span>{[source.filingType, source.item && `Item ${source.item}`, source.section].filter(Boolean).join(" · ") || "Indexed filing passage"}</span>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer">Open filing ↗</a> : <small>Link unavailable</small>}</div></article>;
}

function AuthGate() {
  return <div className="chat-auth-gate"><div className="card-mark">F</div><p className="kicker">FinRAG workspace</p><h1>{clerkEnabled ? "Sign in to open your desk" : "Local workspace mode"}</h1><p>{clerkEnabled ? "Your filing questions and sourced answers are waiting in one focused workspace." : "Add Clerk keys to enable protected sign in. You can still preview the workspace locally."}</p>{clerkEnabled ? <div className="auth-actions"><SignInButton mode="modal" fallbackRedirectUrl="/chat"><button className="button button-copper">Sign in</button></SignInButton><SignUpButton mode="modal" fallbackRedirectUrl="/chat"><button className="button button-quiet">Create account</button></SignUpButton></div> : <Link href="/" className="button button-copper">Back to overview</Link>}</div>;
}

function Workspace({ getToken }) {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [indexPrompt, setIndexPrompt] = useState(null);
  const [ambiguousPrompt, setAmbiguousPrompt] = useState(null);
  const [indexJob, setIndexJob] = useState(null);
  const [indexing, setIndexing] = useState(false);
  const [moreCompaniesLoading, setMoreCompaniesLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    const action = indexPrompt?.company?.action;
    if (action === "none") {
      setIndexPrompt(null); setIndexJob(null); setQuestion(""); setError("");
    } else if (action === "more") {
      void showMoreCompanies();
    }
  }, [indexPrompt?.company?.action]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (saved.length) { setConversations(saved); setActiveId(saved[0].id); return; }
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
      const first = makeConversation(legacy, legacy.find((item) => item.role === "user")?.content || "New research thread");
      setConversations([first]); setActiveId(first.id);
    } catch { const first = makeConversation(); setConversations([first]); setActiveId(first.id); }
  }, []);

  const active = useMemo(() => conversations.find((item) => item.id === activeId) || conversations[0], [conversations, activeId]);
  const messages = active?.messages || [];
  useEffect(() => { if (conversations.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations)); }, [conversations]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length, loading]);

  useEffect(() => {
    if (!indexJob?.cik || !activeIngestionStatuses.has(indexJob.status)) return undefined;
    const poll = async () => {
      try {
        const token = getToken ? await getToken() : null;
        const response = await fetch(`${API_BASE_URL}/api/companies/${indexJob.cik}/status`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) return;
        const next = payload.data.ingestion;
        setIndexJob(next);
        if (next.status === "READY") { setIndexPrompt(null); setError(""); }
        if (next.status === "FAILED") setError(next.error || "Company indexing failed. You can try again.");
      } catch { /* A later poll can recover from a temporary status request failure. */ }
    };
    void poll();
    const timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
  }, [indexJob?.cik, indexJob?.status, getToken]);

  function updateActive(nextMessages, title) { setConversations((current) => current.map((item) => item.id === activeId ? { ...item, messages: nextMessages, title: title || item.title, updatedAt: Date.now() } : item)); }
  function newChat() { const next = makeConversation(); setConversations((current) => [next, ...current]); setActiveId(next.id); setQuestion(""); setError(""); setIndexPrompt(null); setAmbiguousPrompt(null); }
  function clearCurrent() { updateActive([], "New research thread"); setQuestion(""); setError(""); }

  async function requestIndexing() {
    if (!indexPrompt?.company?.cik || indexing) return;
    setIndexing(true); setError("");
    try {
      const token = getToken ? await getToken() : null;
      const response = await fetch(`${API_BASE_URL}/api/companies/${indexPrompt.company.cik}/ingestion`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ forms: ["10-K", "10-Q"] }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message || "You are not authorized to index this company.");
      setIndexJob(payload.data.job); setIndexPrompt((current) => current ? { ...current, status: payload.data.job.status } : current);
    } catch (requestError) { setError(requestError.message); } finally { setIndexing(false); }
  }

  async function showMoreCompanies() {
    if (!indexPrompt?.searchTerm || moreCompaniesLoading) return;
    setMoreCompaniesLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/companies/search?q=${encodeURIComponent(indexPrompt.searchTerm)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error("Could not load more SEC company matches.");
      const current = (indexPrompt.candidates || []).filter((company) => !company.action);
      const byCik = new Map(current.map((company) => [company.cik, company]));
      for (const company of payload.data.matches || []) byCik.set(company.cik, company);
      setIndexPrompt((value) => value ? { ...value, company: [...byCik.values()][0] || value.company, candidates: [...byCik.values()] } : value);
    } catch (requestError) { setError(requestError.message); }
    finally { setMoreCompaniesLoading(false); }
  }

  async function showMoreAmbiguousCompanies() {
    if (!ambiguousPrompt?.searchTerm || moreCompaniesLoading) return;
    setMoreCompaniesLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/companies/search?q=${encodeURIComponent(ambiguousPrompt.searchTerm)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error("Could not load more SEC company matches.");
      const byCik = new Map((ambiguousPrompt.candidates || []).map((company) => [company.cik, company]));
      for (const company of payload.data.matches || []) byCik.set(company.cik, company);
      setAmbiguousPrompt((value) => value ? { ...value, candidates: [...byCik.values()] } : value);
    } catch (requestError) { setError(requestError.message); }
    finally { setMoreCompaniesLoading(false); }
  }

  async function submit(event, retryValue) {
    event?.preventDefault();
    const trimmed = (retryValue ?? question).trim();
    if (!trimmed || loading || !active) return;
    const userMessage = { role: "user", content: trimmed, id: crypto.randomUUID() };
    updateActive([...messages, userMessage], messages.length ? undefined : trimmed); setQuestion(""); setError(""); setIndexPrompt(null); setAmbiguousPrompt(null); setLoading(true);
    try {
      const token = getToken ? await getToken() : null;
      const response = await fetch(`${API_BASE_URL}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ question: trimmed }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        const requestError = new Error(payload?.error?.message || "FinRAG could not answer that question.");
        requestError.code = payload?.error?.code; requestError.details = payload?.error?.details;
        if (response.status === 429) requestError.message = "Research limit reached. Try again in a moment.";
        if (response.status === 401) requestError.message = "Your session expired. Please sign in again.";
        if (response.status === 504) requestError.message = "That search took too long. Try a narrower question.";
        throw requestError;
      }
      updateActive([...messages, userMessage, { role: "assistant", content: payload.data.answer, sources: payload.data.sources || [], id: crypto.randomUUID() }]);
    } catch (requestError) {
      setQuestion(trimmed);
      if (requestError.code === "COMPANY_NOT_INDEXED") setIndexPrompt(requestError.details);
      if (requestError.code === "AMBIGUOUS_COMPANY") setAmbiguousPrompt(requestError.details);
      setError(requestError.name === "TypeError" ? "The backend is unreachable. Check your connection and try again." : requestError.message);
    } finally { setLoading(false); }
  }

  const indexStatus = indexJob?.status || indexPrompt?.status;
  const indexCandidates = indexPrompt?.candidates?.length > 0 ? [...indexPrompt.candidates, { action: "none", cik: "__none__", name: "None of the above", ticker: "" }, { action: "more", cik: "__more__", name: moreCompaniesLoading ? "Loading more matches…" : "Show more companies", ticker: "" }] : indexPrompt?.company ? [indexPrompt.company, { action: "none", cik: "__none__", name: "None of the above", ticker: "" }, { action: "more", cik: "__more__", name: moreCompaniesLoading ? "Loading more matches…" : "Show more companies", ticker: "" }] : [];
  return <div className="workspace-app"><aside className="chat-sidebar"><Link href="/" className="sidebar-brand"><span className="wordmark-symbol">F</span><span>FINRAG</span></Link><button className="new-chat" onClick={newChat}><span>＋</span> New research</button><div className="history-label">Your threads</div><div className="history-list">{conversations.map((item) => <button className={`history-item ${item.id === activeId ? "active" : ""}`} key={item.id} onClick={() => setActiveId(item.id)}><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></button>)}</div><div className="sidebar-bottom"><Link href="/">About FinRAG</Link><span className="sidebar-divider" /><AccountControl /></div></aside><main className="chat-main"><header className="chat-header"><div><p className="kicker">Research workspace</p><h1>{active?.title || "New research thread"}</h1></div><div className="chat-header-actions"><button className="header-action" onClick={clearCurrent} disabled={!messages.length}>Clear thread</button><AccountControl /></div></header><section className="chat-messages" aria-live="polite">{!messages.length ? <div className="chat-empty"><div className="empty-glyph">⌁</div><p className="kicker">Start with a filing question</p><h2>What do you want<br />to understand?</h2><div className="question-grid">{starters.map((starter) => <button key={starter} onClick={() => setQuestion(starter)}>{starter}<span>↗</span></button>)}</div></div> : messages.map((message, index) => <article className={`chat-message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === "user" ? "You" : "F"}</div><div className="message-content"><div className="message-meta">{message.role === "user" ? "Your question" : "FinRAG answer"}</div><div className="markdown"><ReactMarkdown>{message.content}</ReactMarkdown></div>{message.role === "user" && error && index === messages.length - 1 && <button className="retry-button" onClick={() => submit(null, message.content)}>↻ Retry prompt</button>}{message.role === "assistant" && <><div className="answer-actions"><button className="copy-answer" onClick={() => navigator.clipboard?.writeText(message.content)}>Copy answer</button></div>{message.sources?.length > 0 && <details className="chat-sources"><summary>Sources / {message.sources.length}<span>⌄</span></summary><div className="source-list">{message.sources.map((source, sourceIndex) => <SourceCard source={source} index={sourceIndex} key={`${source.id || sourceIndex}`} />)}</div></details>}</>}</div></article>)}{loading && <article className="chat-message assistant"><div className="message-avatar">F</div><div className="message-content"><div className="message-meta">FinRAG is reading</div><div className="typing"><i /><i /><i /> Searching the filing record…</div></div></article>}<div ref={endRef} /></section><div className="chat-compose-wrap">{ambiguousPrompt?.candidates?.length > 0 && <div className="company-ambiguity-card" role="status"><div><p className="kicker">Choose a company</p><strong>Which SEC company did you mean?</strong><small>Select a candidate to add its ticker to your question. No retrieval or ingestion has started.</small></div><div className="company-candidate-list">{ambiguousPrompt.candidates.map((company) => <button type="button" className="company-candidate" key={company.cik} onClick={() => { setQuestion(`${company.ticker}: ${ambiguousPrompt.query}`); setAmbiguousPrompt(null); setError(""); }}><span>{company.name}</span><small>{company.ticker} · CIK {company.cik}</small></button>)}</div><div className="candidate-actions"><button type="button" className="candidate-secondary" onClick={() => { setAmbiguousPrompt(null); setQuestion(""); setError(""); }}>None of the above</button><button type="button" className="candidate-secondary" onClick={showMoreAmbiguousCompanies} disabled={moreCompaniesLoading}>{moreCompaniesLoading ? "Loading…" : "Show more companies"}</button></div></div>}{indexPrompt && indexStatus !== "READY" && <div className="company-index-card"><div><p className="kicker">Choose a company to index</p><strong>{indexPrompt.company.name} <span>({indexPrompt.company.ticker})</span></strong><small>{indexStatus ? `Status: ${indexStatus.toLowerCase().replaceAll("_", " ")}` : "Select the SEC company you mean, then index its latest 10-K and 10-Q."}</small></div>{indexCandidates.length > 0 && <div className="company-candidate-list">{indexCandidates.map((company) => <button type="button" className={`company-candidate ${company.cik === indexPrompt.company.cik ? "selected" : ""}`} key={company.cik} onClick={() => { setIndexPrompt((current) => current ? { ...current, company, status: null } : current); setIndexJob(null); setError(""); }}><span>{company.name}</span><small>{company.ticker} · CIK {company.cik}</small></button>)}</div>}<button onClick={requestIndexing} disabled={indexing || activeIngestionStatuses.has(indexStatus)}>{indexing || activeIngestionStatuses.has(indexStatus) ? "Indexing…" : `Index ${indexPrompt.company.ticker}`}</button></div>}{error && <div className="chat-error" role="alert"><strong>Search paused.</strong><span>{error}</span><button className="retry-error" onClick={() => submit(null, question)}>Retry</button><button className="dismiss-error" onClick={() => setError("")}>Dismiss</button></div>}<form className="chat-composer" onSubmit={submit}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(event); } }} placeholder="Ask about an SEC filing…" aria-label="Your question" rows="1" disabled={loading} /><button className="send-button" type="submit" disabled={!question.trim() || loading} aria-label="Send question">↑</button><small>Enter to send · Shift + Enter for a new line</small></form></div></main></div>;
}

export default function ChatPage() { return clerkEnabled ? <ProtectedWorkspace /> : <Workspace />; }
function ProtectedWorkspace() { const { isLoaded, isSignedIn, getToken } = useAuth(); if (!isLoaded) return <div className="auth-loading-screen">Checking your session…</div>; return isSignedIn ? <Workspace getToken={getToken} /> : <AuthGate />; }
