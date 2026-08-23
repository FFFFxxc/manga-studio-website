import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'Манга-студия — браузерный редактор манги и артов',
  description:
    'Пакетный браузерный редактор для манги, артов и фотографий. Вотермарки, очистка текста, добавление подписей. Без загрузки на сервер.',
    generator: 'v0.app'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className="bg-[#191919]">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Russo+One&family=Neucha&family=Caveat:wght@400;700&family=Amatic+SC:wght@400;700&family=Bad+Script&family=Pangolin&family=Yanone+Kaffeesatz:wght@400;700&family=Rubik+Mono+One&family=Press+Start+2P&family=Lobster&family=Marck+Script&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${inter.className} antialiased`} style={{ overflow: 'hidden', height: '100vh' }}>
        {children}
      </body>
    </html>
  );
}
