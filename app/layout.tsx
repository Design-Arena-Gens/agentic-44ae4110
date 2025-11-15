import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Lip-Sync Avatar Generator",
  description:
    "Generate expressive lip-synced avatars that speak with emotion and natural motion."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
