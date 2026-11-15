'use client';
import {useState} from 'react';
export type DriverManifest={source:string;sha256:string;files:Record<string,string>;description:string;input_format:string;output_format:string;note:string};
export default function ExecutionDriver({value,recorded}:{value?:DriverManifest;recorded?:DriverManifest}){
 const [snapshot,setSnapshot]=useState(false),[file,setFile]=useState('');const manifest=snapshot&&recorded?recorded:value;
 if(!manifest)return <p className="help-text">Reopen this workspace to load its driver details.</p>;
 const names=Object.keys(manifest.files).sort((a,b)=>a==='adapter.py'?-1:b==='adapter.py'?1:a.localeCompare(b));const selected=names.includes(file)?file:names[0];
 return <section className="execution-driver"><h2>Execution driver</h2><p>{manifest.description}</p><p className="help-text">{manifest.note}</p>{recorded&&<label>Driver snapshot<select value={snapshot?'run':'current'} onChange={e=>setSnapshot(e.target.value==='run')}><option value="current">Current workspace</option><option value="run">Selected recorded run</option></select></label>}<dl><dt>Input encoding</dt><dd>{manifest.input_format}</dd><dt>Output encoding</dt><dd>{manifest.output_format}</dd></dl><label>Driver file<select value={selected} onChange={e=>setFile(e.target.value)}>{names.map(name=><option key={name}>{name}</option>)}</select></label><pre tabIndex={0} aria-label="Full execution driver code"><code>{manifest.files[selected]}</code></pre><small>Driver SHA-256: {manifest.sha256}</small><p className="help-text">Read-only driver. Your solution stays in main.py. If an adapter is wrong, prepare a corrected problem version; saved attempts retain their original driver.</p></section>;
}
