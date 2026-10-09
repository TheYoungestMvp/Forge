import type { GeneratedApp } from "@/lib/generation/schema";

export function composePreview(app: GeneratedApp, token: string): string {
  const payload = JSON.stringify({ ...app, token })
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;min-height:100%;}*{box-sizing:border-box}</style>
</head><body><div id="forge-app" style="display:contents"></div>
<script type="application/json" id="forge-payload">${payload}</script>
<script>
(()=>{
 const payload=JSON.parse(document.getElementById('forge-payload').textContent);
 let failed=false;
 const notify=(type,message='')=>parent.postMessage({channel:'forge-preview',token:payload.token,type,message:String(message).slice(0,400)},'*');
 window.addEventListener('error',event=>{failed=true;notify('error',event.message||'The application encountered a runtime error.')});
 window.addEventListener('unhandledrejection',event=>{failed=true;notify('error',event.reason instanceof Error?event.reason.message:'The application rejected an operation.')});
 try{
  document.title=payload.title;
  const style=document.createElement('style');style.textContent=payload.css;document.head.append(style);
  document.getElementById('forge-app').innerHTML=payload.html;
  const script=document.createElement('script');script.textContent=payload.javascript;document.body.append(script);
  if(!failed)notify('ready');
 }catch(error){failed=true;notify('error',error instanceof Error?error.message:'Unable to load the application.')}
})();
</script></body></html>`;
}
