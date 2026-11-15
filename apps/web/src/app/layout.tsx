import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Rehearsal · Interview Studio', description: 'A focused, local-first space for thoughtful interview practice.' };
export const viewport: Viewport = { themeColor: '#0b0b0b', colorScheme: 'dark light' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:`try{var t=localStorage.getItem('rehearsal-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark';var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==='light'?'#f6f6f6':'#0b0b0b';}catch{}`}}/></head><body>{children}</body></html>;
}
