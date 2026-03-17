import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SAIR Model Eval",
  description: "Run and score equational-theory implication prompts against OpenRouter models.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
