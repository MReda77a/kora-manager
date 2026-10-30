'use client';
// The opening screen: the logo under the floodlights for a moment, once per visit.
import { useEffect, useState } from 'react';

export default function Splash() {
  const [show, setShow] = useState(false);
  const [out, setOut] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem('vamos-splash') === '1'; sessionStorage.setItem('vamos-splash', '1'); } catch {}
    if (seen) return;
    setShow(true);
    const a = setTimeout(() => setOut(true), 1300), b = setTimeout(() => setShow(false), 1750);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  if (!show) return null;
  return (
    <div className={`splash ${out ? 'out' : ''}`} onClick={() => setShow(false)}>
      <i className="splash-beam l" /><i className="splash-beam r" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/logo-256.png" alt="Vamos!" className="splash-logo" />
      <span className="splash-tag">YOUR CLUB · YOUR FRIENDS · YOUR DERBY</span>
      <span className="splash-bar"><i /></span>
    </div>
  );
}
