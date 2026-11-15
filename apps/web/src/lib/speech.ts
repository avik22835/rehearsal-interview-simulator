// Split stable speech without exposing metadata or reading an unfinished word.
export function speechSegments(text:string, final=false): {segments:string[]; consumed:number} {
  if (/^\s*[\[{]/.test(text) || text.includes('```')) return {segments:[],consumed:0};
  const segments:string[]=[]; let start=0;
  for(let i=0;i<text.length;i++) {
    const punctuation=/[.!?]/.test(text[i]);
    const paragraph=text[i]==='\n' && text[i+1]==='\n';
    if(!punctuation&&!paragraph)continue;
    if(punctuation) {
      // Question/exclamation endings are stable even when the provider trims
      // trailing whitespace. A terminal dot still waits (it may become 3.14).
      if(i+1===text.length&&!final&&text[i]==='.')continue;
      if(i+1<text.length&&!/\s/.test(text[i+1]))continue;
      const word=text.slice(start,i+1).match(/\S+$/)?.[0]||'';
      if(/^(?:Mr|Mrs|Ms|Dr|Prof|vs|etc|e\.g|i\.e)\.$/i.test(word)||/^(?:[A-Za-z]\.)+$/.test(word))continue;
    }
    const end=i+1; const piece=text.slice(start,end).trim();
    if(piece)segments.push(piece); start=end;
  }
  if(final&&text.slice(start).trim()){segments.push(text.slice(start).trim());start=text.length;}
  // The API accepts bounded chunks; retain every word of a long sentence.
  const bounded=segments.flatMap(piece=>{const result:string[]=[];while(piece.length>550){let cut=piece.lastIndexOf(' ',550);if(cut<1)cut=550;result.push(piece.slice(0,cut));piece=piece.slice(cut).trimStart();}if(piece)result.push(piece);return result;});
  return {segments:bounded,consumed:start};
}

export function pcmWave(chunks:Float32Array[],rate:number):Blob {
  const length=chunks.reduce((sum,part)=>sum+part.length,0);
  const input=new Float32Array(length);let offset=0;
  for(const part of chunks){input.set(part,offset);offset+=part.length;}
  const count=Math.floor(length*16000/rate), buffer=new ArrayBuffer(44+count*2), view=new DataView(buffer);
  const write=(at:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
  write(0,'RIFF');view.setUint32(4,36+count*2,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,count*2,true);
  // Area-average downsampling avoids taking a single aliased input sample.
  for(let i=0;i<count;i++){const from=Math.floor(i*rate/16000),to=Math.min(length,Math.max(from+1,Math.floor((i+1)*rate/16000)));let sum=0;for(let j=from;j<to;j++)sum+=input[j];view.setInt16(44+i*2,Math.max(-1,Math.min(1,sum/(to-from)))*32767,true);}
  return new Blob([buffer],{type:'audio/wav'});
}
