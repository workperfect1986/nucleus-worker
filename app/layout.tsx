import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Studio Laser · Central de trabalhos",
  description: "Acompanhe ordens de serviço e o andamento da produção.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
