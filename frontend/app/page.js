"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { SignInButton, SignUpButton, UserButton, useAuth, useUser } from "@clerk/nextjs";

const STORAGE_KEY = "finrag-chat-history";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";

const starters = [
  "What are Apple's main products and services?",
  "Summarize the key risks in the latest filing.",
  "How did revenue change compared with the prior period?",
];

function SourceCard({ source, index }) {
  const label = [source.company, source.ticker && `(${source.ticker})`].filter(Boolean).join(" ") || `SEC filing ${index + 1}`;
  return <article className="source-card">
    <div className="source-topline"><span className="source-index">0{index + 1}</span><span>SEC filing</span></div>
    <strong>{label}</strong>
    <span className="source-meta">{[source.filingType, source.item && `Item ${source.item}`, source.section].filter(Boolean).join(" · ")}</span>
    <div className="source-actions">{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer">Open filing <span aria-hidden="true">↗</span></a> : <span className="source-unavailable">Link unavailable</span>}</div>
  </article>;
}

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function AccountBar() {
  if (!clerkEnabled) return <span className="local-mode">Local mode</span>;
  return <div className="account"><SignInButton mode="modal"><button className="text-button">Sign in</button></SignInButton><SignUpButton mode="modal"><button className="account-button">Create account</button></SignUpButton><UserButton /></div>;
}

function ProtectedChat() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  if (!isLoaded) return <div className="auth-loading">Checking your session…</div>;
  if (!isSignedIn) return <div className="auth-empty"><div className="signal">⌁</div><p className="eyebrow">Private research workspace</p><h2>Sign in to start asking.</h2><p>Keep your filing questions and sourced answers in one place.</p><div className="auth-actions"><SignInButton mode="modal"><button className="primary-button">Sign in</button></SignInButton><SignUpButton mode="modal"><button className="secondary-button">Create account</button></SignUpButton></div></div>;
  return <Chat getToken={getToken} userName={user?.firstName} />;
}

function Chat({ getToken, userName }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    try { setMessages(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]")); } catch { setMessages([]); }
  }, []);

  useEffect(() => {
    if (messages.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    else window.localStorage.removeItem(STORAGE_KEY);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function submit(event) {
    event?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    const userMessage = { role: "user", content: trimmed, id: crypto.randomUUID() };
    setMessages((current) => [...current, userMessage]);
    setQuestion(""); setError(""); setLoading(true);
    try {
      const token = getToken ? await getToken() : null;
      const response = await fetch(`${API_BASE_URL}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ question: trimmed }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        const message = response.status === 429 ? "You’ve reached the research limit. Please wait a moment and try again." : response.status === 401 ? "Your session expired. Please sign in again." : response.status === 504 ? "The filing search took too long. Try a narrower question." : payload?.error?.message || "FinRAG could not answer that question.";
        throw new Error(message);
      }
      setMessages((current) => [...current, { role: "assistant", content: payload.data.answer, sources: payload.data.sources || [], id: crypto.randomUUID() }]);
    } catch (requestError) {
      setError(requestError.name === "TypeError" ? "The backend is unreachable. Check your connection and try again." : requestError.message || "FinRAG could not complete that search.");
    } finally { setLoading(false); }
  }

  function clearHistory() { setMessages([]); setError(""); }

  return <>
        <div className="messages" aria-live="polite">
          {messages.length === 0 ? <div className="empty-state">
            <div className="signal">⌁</div><p className="eyebrow">Start a research thread</p><h2>What would you like to understand?</h2>
            <div className="starter-grid">{starters.map((starter) => <button key={starter} onClick={() => setQuestion(starter)}>{starter}<span>↗</span></button>)}</div>
          </div> : messages.map((message) => <div className={`message ${message.role}`} key={message.id}>
            <div className="message-label">{message.role === "user" ? "You" : "FinRAG"}</div>
            <div className="message-body"><ReactMarkdown>{message.content}</ReactMarkdown></div>
            {message.role === "assistant" && <div className="message-tools"><button onClick={() => navigator.clipboard?.writeText(message.content)}>Copy answer</button></div>}
            {message.role === "assistant" && message.sources?.length > 0 && <div className="sources"><div className="sources-heading">Sources · {message.sources.length}</div>{message.sources.map((source, index) => <SourceCard source={source} index={index} key={`${source.id || index}`} />)}</div>}
          </div>)}
          {loading && <div className="message assistant"><div className="message-label">FinRAG</div><div className="loading"><span /><span /><span /> Searching the filing record…</div></div>}
          <div ref={endRef} />
        </div>
        {error && <div className="error" role="alert"><strong>Could not complete that search.</strong><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
        <form className="composer" onSubmit={submit}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(event); } }} placeholder="Ask about an SEC filing…" aria-label="Your question" rows="1" disabled={loading} /><button type="submit" disabled={!question.trim() || loading} aria-label="Send question">↑</button>{messages.length > 0 && <button type="button" className="clear-button" onClick={clearHistory}>Clear</button>}<small>Enter to send · Shift + Enter for a new line</small></form>
  </>;
}

export default function Home() {
  return <main className="shell"><header className="masthead"><div className="brand"><span className="brand-mark">F</span><span>FINRAG</span></div><div className="status"><span className="status-dot" /> Filing-grounded research</div><AccountBar /></header><section className="workspace"><aside className="intro"><p className="eyebrow">SEC filing intelligence</p><h1>Ask the filing.<br /><em>Find the signal.</em></h1><p className="lede">FinRAG turns dense company filings into clear, sourced answers you can follow back to the record.</p><div className="rule" /><p className="aside-note">Answers are generated from the indexed SEC filing corpus and may be incomplete. Always verify important decisions in the original filing.</p></aside><section className="chat-panel" aria-label="FinRAG chat">{clerkEnabled ? <ProtectedChat /> : <Chat />}</section></section><footer><span>FINRAG / RESEARCH WORKSPACE</span><span>Sources link to SEC filings ↗</span></footer></main>;
}
