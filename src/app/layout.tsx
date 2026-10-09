import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
