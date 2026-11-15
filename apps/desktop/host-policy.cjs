'use strict';
const AUTH_HOSTS = new Set(['accounts.google.com', 'login.microsoftonline.com', 'appleid.apple.com']);
function allowedNavigation(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com') ||
       url.hostname === 'openai.com' || url.hostname.endsWith('.openai.com') || AUTH_HOSTS.has(url.hostname));
  } catch { return false; }
}
function safeOrigin(value) {
  try { return new URL(value).origin; } catch { return 'unknown'; }
}
function layout(width, height, mode = 'split') {
  width = Math.max(0, Math.floor(width)); height = Math.max(0, Math.floor(height));
  if (mode === 'studio') return { studio:{x:0,y:0,width,height}, chat:null };
  if (mode === 'chat') return { studio:null, chat:{x:0,y:0,width,height} };
  const chatWidth = Math.min(width, Math.max(420, Math.floor(width * 0.44)));
  return { studio:{x:0,y:0,width:width-chatWidth,height}, chat:{x:width-chatWidth,y:0,width:chatWidth,height} };
}
function sanitizeHealth(value) {
  if (!value || typeof value !== 'object') return null;
  if (!['tick','freeze','resume','visibilitychange','ready'].includes(value.event)) return null;
  const result = {event:value.event, hidden:!!value.hidden, focused:!!value.focused, composerReady:!!value.composerReady};
  for (const key of ['ticks','elapsedMs','maxGapMs']) {
    if (!Number.isFinite(value[key]) || value[key]<0) return null;
    result[key]=Math.min(Math.round(value[key]),Number.MAX_SAFE_INTEGER);
  }
  return result;
}
function allowedStudioAudio(permission,origin,details={}) {
  if(permission!=='media'||safeOrigin(origin)!=='http://127.0.0.1:3000'||details.isMainFrame===false)return false;
  // Electron uses mediaTypes for requests, mediaType for permission checks.
  if(Array.isArray(details.mediaTypes))return details.mediaTypes.length===1&&details.mediaTypes[0]==='audio';
  return details.mediaType==='audio';
}
module.exports = { allowedNavigation, safeOrigin, layout, sanitizeHealth, allowedStudioAudio };
