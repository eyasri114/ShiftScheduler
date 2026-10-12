import type { Metadata } from "next";
import "@fontsource-variable/heebo";
import "./globals.css";

export const metadata: Metadata = {
  title: "סידור משמרות",
  description: "בניית סידור עבודה במשמרות לחנויות ולעסקים",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
