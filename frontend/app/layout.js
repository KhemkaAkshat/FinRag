import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata = {
  title: "FinRAG — SEC filing intelligence",
  description: "Ask questions grounded in SEC filings.",
};

export default function RootLayout({ children }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const content = publishableKey ? <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider> : children;
  return <html lang="en"><body>{content}</body></html>;
}
