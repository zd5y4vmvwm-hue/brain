// Read a selected node from the existing graph document after its own gate opens.
// The stable memory entry can do this even when a nightly build replaces the
// graph's optional integration script. Never persist or transmit a draft here.
export function chooseGraphEntry(onPick) {
  const overlay = document.createElement('div');
  overlay.className = 'graph-picker';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '← Return to memory';
  const frame = document.createElement('iframe'); frame.title = 'Select a Brain graph entry';
  frame.src = new URL('../?memory-picker', location.href).href;
  let watch;
  function exit() { watch?.disconnect(); overlay.remove(); }
  close.addEventListener('click', exit);
  frame.addEventListener('load', () => {
    watch?.disconnect();
    const win = frame.contentWindow, doc = frame.contentDocument;
    const panel = doc?.getElementById('panel');
    if (!win || !panel) return;
    function attach() {
      const node = win.GRAPH?.nodes?.find(item => item.id === win.BRAIN_STATE?.sel);
      if (!node || panel.style.display === 'none' || panel.querySelector('[data-pick]')) return;
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = 'Use this entry in memory';
      button.dataset.pick = 'true'; button.style.cssText = 'margin:8px 0;color:#7dffc8;background:#101b15;font:inherit;padding:8px 12px;border:1px solid #3d7055';
      button.addEventListener('click', () => {
        const value = {title:String(node.label),body:String(node.text),source:'Brain graph · ' + node.id};
        exit(); onPick(value);
      });
      panel.append(button);
    }
    watch = new MutationObserver(attach); watch.observe(panel, {childList:true}); attach();
  });
  overlay.append(close, frame); document.body.append(overlay); close.focus();
  return exit;
}
