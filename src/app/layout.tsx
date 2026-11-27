import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/useData";
import "./globals.css";

export const metadata = { title: "DICES check-in" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
