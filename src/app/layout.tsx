import type { Metadata } from "next";
import "driver.js/dist/driver.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "findmydoc Planning",
  description: "Teaminterne findmydoc Planungsseite",
  icons: {
    icon: "/assets/icon-mark.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
