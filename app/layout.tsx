import type { Metadata, Viewport } from 'next';
import '@fontsource/bebas-neue/400.css';
import './globals.css';
import SwRegister from '../components/SwRegister.tsx';
import Splash from '../components/Splash.tsx';

export const metadata: Metadata = {
  title: 'Vamos!', description: 'Build your club, pick your tactics, beat your friends.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png?v=3', apple: '/icons/apple-touch-icon.png?v=3' },
  appleWebApp: { capable: true, title: 'Vamos!', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0A1626' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&display=swap" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <div className="rotate">Turn your phone sideways for the best view</div>
        <SwRegister />
        <Splash />
        {children}
      </body>
    </html>
  );
}
