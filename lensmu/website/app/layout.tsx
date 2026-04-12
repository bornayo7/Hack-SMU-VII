import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "VisionTranslate | Translate text inside images across the web",
  description:
    "VisionTranslate, also called LensMU, is a browser extension that detects text inside webpage images and overlays translated text directly on the page.",
  keywords: [
    "VisionTranslate",
    "LensMU",
    "browser extension",
    "OCR",
    "image translation",
    "manga translation",
    "AI translation"
  ],
  openGraph: {
    title: "VisionTranslate",
    description:
      "Translate foreign-language text embedded in images, manga panels, screenshots, signs, menus, and scanned pages.",
    type: "website"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
