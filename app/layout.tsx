import type { Metadata, Viewport } from 'next';
import './globals.css';
import SwRegister from '../components/SwRegister.tsx';

export const metadata: Metadata = {
  title: 'Kora Manager', description: 'Build your club, pick your tactics, beat your friends.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Kora', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#1E1250' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lalezar&family=Cairo:wght@600;700;800;900&display=swap" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <div className="rotate">Turn your phone sideways for the best view</div>
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
