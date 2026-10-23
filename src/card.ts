// The Echo Show card: one self-contained HTML file, no external fetches in host mode.
// Host mode (MCP Apps): rendered from the tool result's structuredContent.board, delivered by postMessage.
// Standalone mode (/demo): same HTML, polls /demo/state every 4 s while visible, pausing after about 5 minutes (same-origin only).

export const CARD_MIME = "text/html;profile=mcp-app";

export const CARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kitchen Table</title>
<style>
:root{--bg:#0e1116;--panel:#171c24;--line:#2a3340;--ink:#f2f5f8;--dim:#8d9aab;--accent:#00d4d4;--maya:#ff8fb1;--sam:#7fb6ff;--priya:#b79cff}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1024px;min-height:600px;margin:0 auto;padding:20px 24px;display:flex;flex-direction:column;gap:14px}
h1{font-size:22px;margin:0;letter-spacing:.02em;display:flex;justify-content:space-between;align-items:baseline}
h1 small{font-weight:400;color:var(--dim);font-size:14px}
.strip{display:flex;gap:10px}
.strip div{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:18px}
.strip b{display:block;color:var(--accent);font-size:13px;letter-spacing:.08em;text-transform:uppercase}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1}
@media(max-width:640px){.cols,.strip{grid-template-columns:1fr;flex-direction:column}}
.col{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.col h2{margin:0 0 10px;font-size:15px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em}
.row{display:flex;align-items:center;gap:12px;padding:10px 6px;border-bottom:1px solid var(--line);font-size:24px}
.row:last-child{border-bottom:0}
.chip{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:16px;font-weight:700;color:#0e1116;flex:none}
.sub{font-size:15px;color:var(--dim)}
.grow{flex:1;min-width:0}
.tag{font-size:14px;color:#0e1116;background:var(--accent);border-radius:999px;padding:2px 10px;white-space:nowrap}
.run{margin-bottom:12px}
.run h3{margin:0 0 4px;font-size:18px;font-weight:600}
.run .row{font-size:20px;padding:6px}
.fresh{animation:pop 2.4s ease-out}
@keyframes pop{0%{background:#00d4d455;transform:scale(1.03)}100%{background:transparent;transform:none}}
.deed{background:#2a2410;border:1px solid #6b5a14;color:#ffd866;border-radius:12px;padding:8px 14px;font-size:18px}
.deed b{color:#fff}
.inbox{background:#10151c;border:1px dashed var(--line);border-radius:14px;padding:10px 16px;font-size:16px}
.inbox h2{margin:0 0 6px;font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em}
.muted{color:var(--dim)}
</style></head>
<body><div class="wrap" id="app"><h1>Kitchen Table <small>waiting for the board…</small></h1></div>
<script>
(function(){
  var app=document.getElementById('app');
  var COLORS={member_maya:'var(--maya)',member_sam:'var(--sam)',member_priya:'var(--priya)'};
  var seen={};
  function esc(t){var d=document.createElement('div');d.textContent=t==null?'':String(t);return d.innerHTML;}
  function chip(id,name){return '<span class="chip" style="background:'+(COLORS[id]||'var(--accent)')+'">'+esc((name||'?').charAt(0))+'</span>';}
  function render(b,inbox){
    if(!b)return;
    var h='<h1>Kitchen Table <small>'+esc(b.as_of_iso?new Date(b.as_of_iso).toLocaleString('en-US',{timeZone:'America/New_York',weekday:'long',hour:'numeric',minute:'2-digit'}):'')+'</small></h1>';
    h+='<div class="strip">'+(b.strip||[]).map(function(s){return '<div><b>'+esc(s.day)+' '+esc(s.time)+'</b>'+esc(s.label)+'</div>';}).join('')+'</div>';
    if(b.deed)h+='<div class="deed">\u2605 Deed of the week \u00b7 <b>'+esc(b.deed.name)+'</b> \u2014 '+esc(b.deed.text)+(b.deed.count>1?' ('+b.deed.count+' deeds)':'')+'</div>';
    h+='<div class="cols"><div class="col"><h2>Needs</h2>';
    var needs=b.needs||[];
    if(!needs.length)h+='<div class="muted">Nothing needed right now.</div>';
    needs.forEach(function(n){
      var sig=n.status+'|'+(n.errand_id||'');
      var fresh=(seen[n.need_id]!==undefined&&seen[n.need_id]!==sig)||(seen.__first&&b.highlight_need_id===n.need_id);
      seen[n.need_id]=sig;
      h+='<div class="row'+(fresh?' fresh':'')+'">'+chip(n.owner,n.owner_name)+'<div class="grow">'+esc(n.item)+'<div class="sub">'+esc(n.owner_name)+(n.due_label?' · due '+esc(n.due_label):'')+(n.note?' · '+esc(n.note):'')+'</div></div>'+(n.errand_label?'<span class="tag">on a run</span>':'')+'</div>';
    });
    h+='</div><div class="col"><h2>Errands</h2>';
    (b.errands||[]).forEach(function(e){
      h+='<div class="run"><h3>'+esc(e.label)+'</h3>';
      (e.items||[]).forEach(function(i){
        var f=i.need_id&&seen['run:'+i.need_id]===undefined&&seen.__ready;
        if(i.need_id)seen['run:'+i.need_id]=1;
        h+='<div class="row'+(f||(i.need_id&&b.highlight_need_id===i.need_id&&!seen.__first)?' fresh':'')+'"><div class="grow">'+esc(i.label)+'</div>'+(i.from?'<span class="tag">from '+esc(i.from)+'</span>':'')+'</div>';
      });
      h+='</div>';
    });
    h+='</div></div>';
    if(inbox){
      h+='<div class="inbox"><h2>Priya\\'s phone</h2>'+(inbox.length?inbox.map(function(m){return '<div>'+esc(m.text)+'</div>';}).join(''):'<span class="muted">No nudges yet.</span>')+'</div>';
    }
    app.innerHTML=h;
    seen.__first=false;seen.__ready=true;
  }
  seen.__first=true;
  window.addEventListener('message',function(e){
    var m=e.data;
    if(m&&m.method==='ui/notifications/tool-result'){
      var sc=m.params&&(m.params.structuredContent||(m.params.result&&m.params.result.structuredContent));
      if(sc&&sc.board)render(sc.board);
    }
  });
  if(window.parent!==window){
    try{window.parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{appInfo:{name:'kitchen-table-board',version:'1.0.0'},appCapabilities:{},protocolVersion:'2025-11-21'}},'*');}catch(_){}
  }else{
    // Be gentle with the server: poll every 4 s, only while the tab is visible, and stop after about 5 minutes (click to resume).
    var INTERVAL=4000,WINDOW=5*60*1000,until=Date.now()+WINDOW,paused=false;
    var banner=document.createElement('div');
    banner.style.cssText='position:fixed;left:50%;bottom:14px;transform:translateX(-50%);background:#171c24;border:1px solid #2a3340;color:#8d9aab;font-size:14px;padding:8px 14px;border-radius:999px;cursor:pointer;display:none';
    banner.textContent='Paused to save requests. Click to resume.';
    document.body.appendChild(banner);
    var poll=function(){fetch('state').then(function(r){return r.json();}).then(function(d){render(d.board,d.inbox);}).catch(function(){});};
    var tick=function(){
      if(document.hidden)return;
      if(Date.now()>until){paused=true;banner.style.display='block';return;}
      poll();
    };
    var resume=function(){paused=false;banner.style.display='none';until=Date.now()+WINDOW;poll();};
    banner.addEventListener('click',resume);
    document.addEventListener('visibilitychange',function(){if(!document.hidden&&!paused)poll();});
    poll();setInterval(tick,INTERVAL);
  }
})();
</script></body></html>`;
