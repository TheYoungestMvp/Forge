import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forge — App Builder",
  description: "An AI app builder workspace. Phase 1: interactive mock demo.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
