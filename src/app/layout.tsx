import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BLD Remote Browser",
  description: "Local remote browser control demo for the BLD SDE assignment"
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

