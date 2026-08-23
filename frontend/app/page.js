"use client";

import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function AuthActions({ compact = false }) {
  if (!clerkEnabled) return <div className="config-note">Authentication is ready for deployment. Add your Clerk publishable key to enable sign in.</div>;
  return <ClerkAuthActions compact={compact} />;
}

function ClerkAuthActions({ compact = false }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="config-note">Loading account…</div>;
  if (isSignedIn) return <div className={compact ? "auth-actions compact" : "auth-actions"}><Link href="/chat" className="button button-copper">Open workspace</Link><UserButton /></div>;
  return <div className={compact ? "auth-actions compact" : "auth-actions"}>
    <SignInButton mode="modal" fallbackRedirectUrl="/chat"><button className="button button-quiet">Sign in</button></SignInButton>
    <SignUpButton mode="modal" fallbackRedirectUrl="/chat"><button className="button button-copper">Create account</button></SignUpButton>
  </div>;
}

export default function Home() {
  return <main className="landing-shell">
    <header className="landing-nav">
      <Link href="/" className="wordmark"><span className="wordmark-symbol">F</span><span>FINRAG</span></Link>
      <nav><a href="#how-it-works">How it works</a><a href="#about">About</a><Link href="/chat">Workspace</Link></nav>
      <AuthActions compact />
    </header>
    <section className="hero" id="about"><div className="hero-copy"><p className="kicker"><span className="live-mark" /> SEC filing intelligence / 2026</p><h1>Read the record.<br /><em>See what matters.</em></h1><p className="hero-lede">FinRAG turns dense company filings into focused, source-linked answers for investors, analysts, and anyone who needs the facts without the noise.</p><div className="hero-actions"><AuthActions /><Link href="/chat" className="text-link">Explore the workspace <span>↗</span></Link></div></div><div className="hero-art" aria-label="Illustration of a filing research workspace"><div className="art-caption">A filing, made legible</div><div className="filing-sheet"><div className="sheet-top"><span>10-K / 2025</span><span>01—24</span></div><div className="sheet-rule" /><div className="sheet-title">Annual<br /><em>Report</em></div><div className="sheet-lines"><i /><i /><i /><i /></div><div className="sheet-stamp">RRF<br />VERIFIED</div></div><div className="signal-orbit orbit-one" /><div className="signal-orbit orbit-two" /></div></section>
    <section className="proof-strip"><div><strong>01</strong><span>Grounded in filings</span></div><div><strong>02</strong><span>Answers with sources</span></div><div><strong>03</strong><span>Built for clear thinking</span></div></section>
    <section className="how-section" id="how-it-works"><div className="section-intro"><p className="kicker">The research loop</p><h2>From question<br />to evidence.</h2></div><div className="process-grid"><article><span className="process-index">01</span><h3>Ask naturally</h3><p>Start with the question you would ask a colleague. No special syntax, tickers, or search operators required.</p></article><article><span className="process-index">02</span><h3>Find the signal</h3><p>FinRAG searches the indexed SEC record using semantic and lexical retrieval to surface relevant passages.</p></article><article><span className="process-index">03</span><h3>Follow the record</h3><p>Every answer keeps its source context close, so important claims can be checked against the original filing.</p></article></div></section>
    <section className="login-panel"><div><p className="kicker">Your research desk</p><h2>Keep the question.<br /><em>Return to the thread.</em></h2><p>Sign in to open the workspace and keep your conversations organized in a familiar chat layout.</p></div><div className="login-card"><div className="card-mark">F</div><strong>Enter FinRAG</strong><span>Private filing research, in one place.</span><AuthActions /></div></section>
    <footer className="landing-footer"><span>FINRAG / SEC FILING INTELLIGENCE</span><span>Answers are informational. Verify important decisions in the original filing.</span></footer>
  </main>;
}
