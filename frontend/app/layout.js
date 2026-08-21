import "./globals.css";

export const metadata = {
  title: "FinRAG — SEC filing intelligence",
  description: "Ask questions grounded in SEC filings.",
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
