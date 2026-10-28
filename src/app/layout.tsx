import type { Metadata } from "next";
import "./globals.css";
import { PlanningStateProvider } from "@/features/planning/organisms/planning-state-provider";

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
      <body className="min-h-full flex flex-col"><PlanningStateProvider>{children}</PlanningStateProvider></body>
    </html>
  );
}
