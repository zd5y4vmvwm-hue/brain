(() => {
  if (parent !== window && new URLSearchParams(location.search).has('memory-picker')) return;
  const $ = id => document.getElementById(id);
  let frame = null, capture = null, previousFocus = null;

  async function open(value) {
    if (frame) return;
    capture = value;
    previousFocus = document.activeElement;
    window.brainCtl?.hold();
    // A narrower registration also gives memory its own offline navigation cache.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./memory/sw.js', {scope:'./memory/'}).catch(() => {});
    }
    frame = document.createElement('iframe');
    frame.title = 'Encrypted memory'; frame.src = './memory/';
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:#050706;z-index:50';
    document.body.append(frame); frame.focus();
  }
  addEventListener('message', event => {
    if (!frame || event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'brain-memory-ready' && capture) {
      frame.contentWindow.postMessage({type:'brain-memory-capture', ...capture}, location.origin);
      capture = null;
    } else if (event.data?.type === 'brain-memory-close') {
      frame.remove(); frame = null; capture = null; previousFocus?.focus();
    }
  });
  const button = (title, handler) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = title; btn.addEventListener('click', handler); return btn;
  };
  const gate = $('gform');
  if (gate) {
    const enter = button('Open encrypted memory', () => open(null));
    enter.style.cssText = 'margin-top:8px;background:#101b15;border:1px solid #5dff7a;color:#a1ffbf;font-size:13px';
    gate.append(enter);
  }
  $('ctl')?.append(button('MEMORY', () => open(null)));
  const panel = $('panel');
  if (panel) {
    new MutationObserver(() => {
      const node = window.GRAPH?.nodes?.find(n => n.id === window.BRAIN_STATE?.sel);
      if (!node || panel.querySelector('[data-memory-capture]') || panel.style.display === 'none') return;
      const save = button('Copy to editable memory', () => open({title:String(node.label), body:String(node.text), source:'Brain graph · ' + node.id}));
      save.setAttribute('data-memory-capture',''); save.style.cssText = 'margin:8px 0;padding:8px 12px;color:#7dffc8;background:#101b15;border:1px solid #3d7055;font:inherit';
      panel.append(save);
    }).observe(panel,{childList:true});
  }
  // Recheck the original nightly worker on return. Keep its current graph in
  // view until the user chooses to load a newly available encrypted build.
  if ('serviceWorker' in navigator) {
    let registration;
    navigator.serviceWorker.getRegistration(location.href).then(result => { registration = result; });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) registration?.update().catch(() => {});
    });
  }
})();
