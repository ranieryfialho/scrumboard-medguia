import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// T-140 (fase4-design-system-shell-acesso, AC-346): Inter (texto) e
// Plus Jakarta Sans (títulos) são as fontes do protótipo Stitch.
// Ficam no repositório (src/app/fonts, licença OFL) em vez de `next/font/google`: o build baixava as fontes da Google e o CI
// quebrava sempre que essa rede falhava. São fontes variáveis (latin), então cobrem todos os pesos usados.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

const plusJakartaSans = localFont({
  src: "./fonts/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MedCRM",
  description: "CRM B2B para Clínicas e Consultórios",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${plusJakartaSans.variable}`}>
      <head>
        {/* Material Symbols Outlined, com suporte ao eixo FILL (AC-346) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className={`${inter.className} antialiased`}>
        {children}
      </body>
    </html>
  );
}