import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YourElba",
  description: "Raccomandazioni spiaggia e attività per l'Isola d'Elba"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="app-shell">
          <header className="app-header">
            <h1>YourElba</h1>
            <p>La tua giornata all&apos;Isola d&apos;Elba, passo dopo passo</p>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
