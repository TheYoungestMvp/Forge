import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const publicSans = localFont({
  src: "./fonts/PublicSans-Latin-Variable.woff2",
  variable: "--font-public-sans",
  weight: "400 700",
  style: "normal",
  display: "swap",
  fallback: [
    "Segoe UI",
    "PingFang SC",
    "Hiragino Sans GB",
    "Microsoft YaHei",
    "sans-serif",
  ],
});

export const metadata: Metadata = {
  title: "Forge — App Builder",
  description:
    "Describe an idea and generate an interactive browser application with AI.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={publicSans.variable}>{children}</body>
    </html>
  );
}
