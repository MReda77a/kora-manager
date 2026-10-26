'use client';
import { useServiceWorker } from './AppSetup.tsx';

export default function SwRegister() {
  useServiceWorker();
  return null;
}
