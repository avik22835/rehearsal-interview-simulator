'use client';

import {useEffect,useState} from 'react';
import {Sun,Moon} from 'lucide-react';

type Theme='dark'|'light';
declare global { interface Window { rehearsalAppearance?:{setTheme:(theme:Theme)=>Promise<boolean>}; } }
function applyTheme(theme:Theme,persist=true){
 document.documentElement.classList.add('theme-changing');
 document.documentElement.dataset.theme=theme;
 requestAnimationFrame(()=>requestAnimationFrame(()=>document.documentElement.classList.remove('theme-changing')));
 const meta=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
 if(meta)meta.content=theme==='dark'?'#0b0b0b':'#f6f6f6';
 if(persist)try{localStorage.setItem('rehearsal-theme',theme);}catch{}
 void window.rehearsalAppearance?.setTheme(theme).catch(()=>{});
}
export default function ThemeToggle(){
 const [theme,setTheme]=useState<Theme>('dark');
 useEffect(()=>{
  const initial=document.documentElement.dataset.theme==='light'?'light':'dark';setTheme(initial);applyTheme(initial,false);
  const sync=(event:StorageEvent)=>{if(event.key!=='rehearsal-theme')return;const next=event.newValue==='light'?'light':'dark';setTheme(next);applyTheme(next,false);};
  window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
 },[]);
 const label=theme==='dark'?'Switch to light theme':'Switch to dark theme';
 return <button className="theme-toggle" aria-label={label} title={label} onClick={()=>{const next=theme==='dark'?'light':'dark';setTheme(next);applyTheme(next);}}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button>;
}
