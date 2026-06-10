// ============================================================
// ELLE WIDGET — src/widget.ts
// Consumer Atlas chat — served by the worker at GET /widget.js
// Embed on ANY page (Astro, React, plain HTML) with one tag:
//
//   <script src="https://elle.sbarteau2022.workers.dev/widget.js" defer></script>
//
// Optional attributes:
//   data-accent="#C9A84C"   accent color override
//   data-title="Elle"        header title
//   data-greeting="..."      first message
//
// No API key required — the widget talks to /api/widget-chat,
// a public rate-limited endpoint. The service key never leaves
// the server.
// ============================================================

export const WIDGET_JS = `(function(){
if (window.__elleWidget) return; window.__elleWidget = true;

var script = document.currentScript || (function(){var s=document.getElementsByTagName('script');return s[s.length-1];})();
var WORKER = (script && script.src) ? script.src.replace(/\\/widget\\.js.*$/,'') : 'https://elle.sbarteau2022.workers.dev';
var ACCENT = (script && script.getAttribute('data-accent')) || '#C9A84C';
var TITLE  = (script && script.getAttribute('data-title')) || 'Elle';
var GREET  = (script && script.getAttribute('data-greeting')) || "I'm Elle \\u2014 the intelligence behind The Ethical Intelligence Project. Ask me anything: the corpus, the programs, or what you're trying to navigate.";

var css = document.createElement('style');
css.textContent = '\\
@import url("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&display=swap");\\
.elw-btn{position:fixed;bottom:22px;right:22px;width:54px;height:54px;border-radius:14px;background:#0f0f1a;border:1px solid '+ACCENT+'55;box-shadow:0 8px 30px rgba(0,0,0,.45);cursor:pointer;z-index:999998;display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;padding:0}\\
.elw-btn:hover{transform:translateY(-2px);box-shadow:0 12px 36px rgba(0,0,0,.55)}\\
.elw-panel{position:fixed;bottom:88px;right:22px;width:390px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#0f0f1a;border:1px solid '+ACCENT+'40;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.6);z-index:999999;display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif}\\
.elw-panel.open{display:flex;animation:elwUp .18s cubic-bezier(.16,1,.3,1) both}\\
@keyframes elwUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}\\
.elw-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid '+ACCENT+'26;background:rgba(201,168,76,.04)}\\
.elw-head-t{font-family:"Playfair Display",serif;font-size:17px;color:#F5F0E8;letter-spacing:.01em}\\
.elw-head-s{font-size:10px;color:'+ACCENT+'AA;font-family:"JetBrains Mono",monospace;margin-top:1px}\\
.elw-x{margin-left:auto;background:none;border:none;color:#F5F0E866;font-size:18px;cursor:pointer;padding:4px 8px;line-height:1}\\
.elw-x:hover{color:#F5F0E8}\\
.elw-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}\\
.elw-msgs::-webkit-scrollbar{width:4px}.elw-msgs::-webkit-scrollbar-thumb{background:'+ACCENT+'33;border-radius:2px}\\
.elw-m{max-width:86%;padding:10px 13px;border-radius:12px;font-size:13.5px;line-height:1.65;white-space:pre-wrap;word-wrap:break-word}\\
.elw-m.elle{align-self:flex-start;background:rgba(245,240,232,.05);border:1px solid '+ACCENT+'22;color:#F5F0E8;border-bottom-left-radius:4px}\\
.elw-m.user{align-self:flex-end;background:'+ACCENT+'1f;border:1px solid '+ACCENT+'38;color:#F5F0E8;border-bottom-right-radius:4px}\\
.elw-m.err{color:#e08585}\\
.elw-think-btn{align-self:flex-start;background:none;border:1px solid '+ACCENT+'30;border-radius:6px;color:'+ACCENT+';font-size:10px;font-family:"JetBrains Mono",monospace;padding:2px 8px;cursor:pointer;margin:-4px 0 0 2px}\\
.elw-think{align-self:flex-start;max-width:86%;font-size:11px;font-family:"JetBrains Mono",monospace;color:#F5F0E877;background:rgba(245,240,232,.03);border:1px solid '+ACCENT+'1a;border-radius:8px;padding:8px 11px;line-height:1.6;white-space:pre-wrap;max-height:180px;overflow-y:auto}\\
.elw-typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px}\\
.elw-typing i{width:5px;height:5px;border-radius:50%;background:'+ACCENT+';animation:elwB 1.2s infinite}\\
.elw-typing i:nth-child(2){animation-delay:.15s}.elw-typing i:nth-child(3){animation-delay:.3s}\\
@keyframes elwB{0%,60%,100%{opacity:.25}30%{opacity:1}}\\
.elw-in{display:flex;gap:8px;padding:12px;border-top:1px solid '+ACCENT+'26;background:rgba(245,240,232,.02)}\\
.elw-ta{flex:1;background:rgba(245,240,232,.05);border:1px solid '+ACCENT+'2a;border-radius:10px;color:#F5F0E8;font-size:13px;font-family:Inter,sans-serif;padding:10px 12px;resize:none;outline:none;line-height:1.5;max-height:90px}\\
.elw-ta:focus{border-color:'+ACCENT+'66}\\
.elw-ta::placeholder{color:#F5F0E833}\\
.elw-send{width:38px;height:38px;align-self:flex-end;border-radius:10px;border:1px solid '+ACCENT+'44;background:'+ACCENT+'22;color:'+ACCENT+';font-size:15px;cursor:pointer;transition:all .12s}\\
.elw-send:hover:not(:disabled){background:'+ACCENT+'38}\\
.elw-send:disabled{opacity:.35;cursor:default}\\
.elw-foot{text-align:center;font-size:9px;color:#F5F0E833;font-family:"JetBrains Mono",monospace;padding:0 0 8px}\\
@media(max-width:480px){.elw-panel{right:8px;bottom:80px;width:calc(100vw - 16px);height:calc(100vh - 100px)}}';
document.head.appendChild(css);

var MARK = '<svg width="26" height="26" viewBox="0 0 28 28" fill="none"><rect x="7" y="7.5" width="1.5" height="13" rx=".75" fill="'+ACCENT+'"/><rect x="7" y="7.5" width="11.5" height="1.5" rx=".75" fill="'+ACCENT+'"/><rect x="7" y="13.25" width="8" height="1.25" rx=".6" fill="'+ACCENT+'" opacity=".6"/><rect x="7" y="19" width="11.5" height="1.5" rx=".75" fill="'+ACCENT+'"/><circle cx="21.5" cy="8.75" r="2" fill="'+ACCENT+'"/></svg>';

var btn = document.createElement('button');
btn.className = 'elw-btn'; btn.setAttribute('aria-label','Chat with Elle'); btn.innerHTML = MARK;
document.body.appendChild(btn);

var panel = document.createElement('div');
panel.className = 'elw-panel';
panel.innerHTML = '<div class="elw-head"><div>'+MARK+'</div><div><div class="elw-head-t">'+TITLE+'</div><div class="elw-head-s">ethical intelligence \\u00b7 live</div></div><button class="elw-x" aria-label="Close">\\u00d7</button></div><div class="elw-msgs"></div><div class="elw-in"><textarea class="elw-ta" rows="1" placeholder="Ask Elle\\u2026"></textarea><button class="elw-send">\\u2191</button></div><div class="elw-foot">powered by elle \\u00b7 the ethical intelligence project</div>';
document.body.appendChild(panel);

var msgs = panel.querySelector('.elw-msgs');
var ta = panel.querySelector('.elw-ta');
var sendBtn = panel.querySelector('.elw-send');
var history = [];
var sessionId = 'w-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
var loading = false;

function addMsg(role, text, cls){
  var d = document.createElement('div');
  d.className = 'elw-m ' + role + (cls ? ' ' + cls : '');
  d.textContent = text;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}

function addThinking(t){
  var b = document.createElement('button');
  b.className = 'elw-think-btn'; b.textContent = '\\u25b8 reasoning';
  var box = document.createElement('div');
  box.className = 'elw-think'; box.style.display = 'none'; box.textContent = t;
  b.onclick = function(){ var open = box.style.display !== 'none'; box.style.display = open ? 'none' : 'block'; b.textContent = open ? '\\u25b8 reasoning' : '\\u25be reasoning'; msgs.scrollTop = msgs.scrollHeight; };
  msgs.appendChild(b); msgs.appendChild(box);
}

function setTyping(on){
  var t = msgs.querySelector('.elw-typing');
  if (on && !t){ t = document.createElement('div'); t.className='elw-typing'; t.innerHTML='<i></i><i></i><i></i>'; msgs.appendChild(t); msgs.scrollTop = msgs.scrollHeight; }
  if (!on && t) t.remove();
}

function send(){
  var q = ta.value.trim();
  if (!q || loading) return;
  ta.value = ''; ta.style.height = 'auto';
  addMsg('user', q);
  history.push({ role:'user', content:q });
  loading = true; sendBtn.disabled = true; setTyping(true);

  fetch(WORKER + '/api/widget-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query:q, messages: history.slice(-16), session_id: sessionId, source: 'widget:' + location.hostname })
  }).then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })
  .then(function(res){
    setTyping(false);
    if (!res.ok || res.d.error){ addMsg('elle', res.d.error || 'Something interrupted the connection.', 'err'); return; }
    if (res.d.thinking) addThinking(res.d.thinking);
    var content = res.d.content || res.d.response || '';
    addMsg('elle', content);
    history.push({ role:'assistant', content: content });
  }).catch(function(){ setTyping(false); addMsg('elle','Connection failed. Try again.','err'); })
  .finally(function(){ loading = false; sendBtn.disabled = false; ta.focus(); });
}

btn.onclick = function(){
  panel.classList.toggle('open');
  if (panel.classList.contains('open')){
    if (!msgs.children.length) addMsg('elle', GREET);
    ta.focus();
  }
};
panel.querySelector('.elw-x').onclick = function(){ panel.classList.remove('open'); };
sendBtn.onclick = send;
ta.addEventListener('keydown', function(e){ if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
ta.addEventListener('input', function(){ ta.style.height='auto'; ta.style.height = Math.min(ta.scrollHeight, 90) + 'px'; });
})();`;
