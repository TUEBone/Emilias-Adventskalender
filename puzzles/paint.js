export function mountPaint(root, src, {state, save, complete}, signal) {
  root.classList.add('paint-studio');
  root.innerHTML = `<div class="toolbar">
<div class="tools" role="group" aria-label="Werkzeuge">
<button data-mode="fill" aria-pressed="true">Füllen</button><button data-mode="brush" aria-pressed="false">Pinsel</button><button data-mode="pan" aria-pressed="false">Schieben</button>
</div>
<div class="tools" role="group" aria-label="Ansicht und Rückgängig">
<button id="minus" type="button" aria-label="Verkleinern">−</button><span class="zoom" id="zoomText">100 %</span><button id="plus" type="button" aria-label="Vergrößern">+</button><button id="undo" type="button">Rückgängig</button>
</div></div>
<div class="viewport" id="viewport"><canvas id="picture" aria-label="Ausmalbild. Mit dem Finger oder der Maus eine Fläche antippen oder ausmalen."></canvas></div>
<div class="palette-title"><span>60 Farben</span><span id="colorLabel"></span></div>
<div class="palette" id="palette" role="group" aria-label="Farben"></div>
<p class="status" id="status" aria-live="polite">Bild wird geladen.</p>
<button id="finish" type="button">Bild fertig</button>
`;
  const canvas = root.querySelector('#picture');
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const viewport = root.querySelector('#viewport');
  const palette = root.querySelector('#palette');
  const status = root.querySelector('#status');
  const undoButton = root.querySelector('#undo');
  const zoomLevels = [1, 1.35, 1.8, 2.5, 3.5, 5];
  const undoStack = [];
  let current, regions, componentPixels;
  let zoomIndex = 0, mode = 'fill', stroke = null;
  let color = null;
  const help = {
    fill: 'Tippe auf eine Fläche, um sie zu füllen.',
    brush: 'Wische zum Malen. Der Pinsel bleibt in der Fläche, in der du angefangen hast.',
    pan: 'Verschiebe das gezoomte Motiv mit dem Finger oder der Maus.'
  };

  const colorNames = ['Rot','Orange','Gold','Gelbgrün','Grün','Mint','Türkis','Himmelblau','Blau','Violett','Pink'];
  const colorHues = [1,27,47,73,125,158,184,201,231,266,324];
  const shades = ['sehr hell','hell','kräftig','dunkel','sehr dunkel'];
  const neutrals = ['Weiß','Hellgrau','Grau','Dunkelgrau','Schwarz'];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 12; col++) {
      const light = [87,72,52,37,22][row];
      const css = col === 11 ? `hsl(0, 0%, ${[100,80,55,28,0][row]}%)` : `hsl(${colorHues[col]}, 82%, ${light}%)`;
      const name = col === 11 ? neutrals[row] : `${colorNames[col]}, ${shades[row]}`;
      const swatch = document.createElement('button');
      swatch.className = 'swatch';
      swatch.type = 'button';
      swatch.style.setProperty('--swatch', css);
      swatch.setAttribute('aria-label', name);
      swatch.setAttribute('aria-pressed', 'false');
      swatch.title = name;
      swatch.addEventListener('click', () => {
        const old = palette.querySelector('[aria-pressed=true]');
        old?.setAttribute('aria-pressed', 'false');
        swatch.setAttribute('aria-pressed', 'true');
        root.querySelector('#colorLabel').textContent = name;
        const sample = document.createElement('canvas');
        const sampleCtx = sample.getContext('2d');
        sampleCtx.fillStyle = css;
        sampleCtx.fillRect(0,0,1,1);
        color = sampleCtx.getImageData(0,0,1,1).data;
      });
      palette.append(swatch);
    }
  }
  palette.children[26].click();

  function applyZoom() {
    const ratio = zoomLevels[zoomIndex];
    const left = (viewport.scrollLeft + viewport.clientWidth/2) / Math.max(canvas.clientWidth,1);
    const top = (viewport.scrollTop + viewport.clientHeight/2) / Math.max(canvas.clientHeight,1);
    canvas.style.width = `${viewport.clientWidth * ratio}px`;
    canvas.style.height = 'auto';
    if (zoomIndex === 0) {
      viewport.scrollTo(0,0);
    } else {
      viewport.scrollTo(left*canvas.clientWidth-viewport.clientWidth/2,top*canvas.clientHeight-viewport.clientHeight/2);
    }
    root.querySelector('#zoomText').textContent = `${Math.round(ratio*100)} %`;
    root.querySelector('#minus').disabled = zoomIndex === 0;
    root.querySelector('#plus').disabled = zoomIndex === zoomLevels.length-1;
  }
  root.querySelector('#minus').onclick = () => { if (zoomIndex > 0) { zoomIndex--; applyZoom(); } };
  root.querySelector('#plus').onclick = () => { if (zoomIndex < zoomLevels.length-1) { zoomIndex++; applyZoom(); } };
  window.addEventListener('resize',applyZoom,{signal});

  function findAreas(data) {
    const {width, height} = data;
    const size = width*height;
    const ink = new Uint8Array(size);
    const zones = new Int32Array(size);
    const queue = new Int32Array(size);
    for (let p = 0; p < size; p++) {
      if (data.data[p*4] < 178) ink[p] = 1;
    }
    // A one-pixel buffer closes faint gaps between line segments.
    for (let p = 0; p < size; p++) {
      if (!ink[p]) continue;
      zones[p] = -1;
      if (p % width > 0) zones[p-1] = -1;
      if (p % width < width-1) zones[p+1] = -1;
      if (p >= width) zones[p-width] = -1;
      if (p+width < size) zones[p+width] = -1;
    }
    const areas = [null];
    for (let p = 0; p < size; p++) {
      if (zones[p]) continue;
      const id = areas.length;
      let first = 0, end = 1;
      queue[0] = p;
      zones[p] = id;

      function visit(next) {
        if (zones[next] !== 0) return;
        zones[next] = id;
        queue[end++] = next;
      }
      while (first < end) {
        const pixel = queue[first++];
        if (pixel % width > 0) visit(pixel-1);
        if (pixel % width < width-1) visit(pixel+1);
        if (pixel >= width) visit(pixel-width);
        if (pixel+width < size) visit(pixel+width);
      }
      areas.push(queue.slice(0,end));
    }
    return {zones,areas};
  }

  async function loadArt() {
    undoButton.disabled = true;
    const image = new Image();
    image.src = src;
    try {
      await image.decode();
    } catch {
      status.textContent = 'Das Bild konnte nicht geladen werden.';
      return;
    }
    if (signal.aborted) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    ctx.drawImage(image,0,0);
    const base = ctx.getImageData(0,0,canvas.width,canvas.height);
    const areas = findAreas(base);
    regions = areas.zones;
    componentPixels = areas.areas;
    let restored = base;
    if (state.paint) {
      const painted = new Image();
      painted.src = state.paint;
      try {
        await painted.decode();
        if (signal.aborted) return;
        if (painted.naturalWidth === canvas.width && painted.naturalHeight === canvas.height) {
          ctx.drawImage(painted,0,0);
          restored = ctx.getImageData(0,0,canvas.width,canvas.height);
        }
      } catch {}
    }
    if (signal.aborted) return;
    current = restored;
    applyZoom();
    status.textContent = help[mode];
  }
  loadArt();

  function savePainting() {
    state.paint = canvas.toDataURL();
    save();
  }
  root.querySelector('#finish').onclick = () => {
    if (!current) return;
    savePainting();
    complete('Dein Ausmalbild ist fertig!');
  };

  root.querySelectorAll('[data-mode]').forEach(button => {
    button.onclick = () => {
      mode = button.dataset.mode;
      root.querySelectorAll('[data-mode]').forEach(item => {
        item.setAttribute('aria-pressed',String(item === button));
      });
      viewport.classList.toggle('pan',mode === 'pan');
      if (current) status.textContent = help[mode];
    };
  });

  function remember() {
    if (undoStack.length >= 7) undoStack.shift();
    undoStack.push(new ImageData(new Uint8ClampedArray(current.data),current.width,current.height));
    undoButton.disabled = false;
  }
  undoButton.onclick = () => {
    if (!undoStack.length) return;
    current = undoStack.pop();
    ctx.putImageData(current,0,0);
    undoButton.disabled = !undoStack.length;
    savePainting();
  };
  function pixelPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(canvas.width-1, Math.max(0,Math.floor((event.clientX-rect.left)*canvas.width/rect.width)));
    const y = Math.min(canvas.height-1, Math.max(0,Math.floor((event.clientY-rect.top)*canvas.height/rect.height)));
    return {x,y,id:regions[y*canvas.width+x]};
  }
  function setColor(pixel, rgb) {
    const offset = pixel*4;
    current.data[offset] = rgb[0];
    current.data[offset+1] = rgb[1];
    current.data[offset+2] = rgb[2];
  }
  function dab(x,y) {
    const r = stroke.radius;
    const w = canvas.width, h = canvas.height;
    for (let yy=Math.max(0,y-r); yy<=Math.min(h-1,y+r); yy++) {
      for (let xx=Math.max(0,x-r); xx<=Math.min(w-1,x+r); xx++) {
        const p = yy*w+xx;
        if (regions[p] === stroke.id && (xx-x)**2+(yy-y)**2 <= r*r) setColor(p,stroke.color);
      }
    }
  }
  canvas.addEventListener('pointerdown',event => {
    if (!current || stroke || event.button !== 0) return;
    if (mode === 'pan') {
      if (event.pointerType !== 'mouse') return;
      stroke = {pan:true,pointer:event.pointerId,x:event.clientX,y:event.clientY};
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    const pos = pixelPosition(event);
    if (pos.id <= 0) return;
    remember();
    if (mode === 'fill') {
      for (const pixel of componentPixels[pos.id]) setColor(pixel,color);
    } else {
      stroke = {...pos,pointer:event.pointerId,color,radius:Math.max(2,Math.round(9*canvas.width/canvas.clientWidth))};
      canvas.setPointerCapture(event.pointerId);
      dab(stroke.x,stroke.y);
    }
    ctx.putImageData(current,0,0);
    if (mode === 'fill') savePainting();
  });
  canvas.addEventListener('pointermove',event => {
    if (!stroke || stroke.pointer !== event.pointerId) return;
    if (stroke.pan) {
      viewport.scrollLeft += stroke.x-event.clientX;
      viewport.scrollTop += stroke.y-event.clientY;
      stroke.x = event.clientX;
      stroke.y = event.clientY;
      return;
    }
    const {x,y} = pixelPosition(event);
    const dx = x-stroke.x, dy = y-stroke.y;
    const steps = Math.max(1,Math.ceil(Math.hypot(dx,dy)/Math.max(1,stroke.radius/2)));
    for (let step=1;step<=steps;step++) {
      dab(Math.round(stroke.x+dx*step/steps),Math.round(stroke.y+dy*step/steps));
    }
    stroke.x = x;
    stroke.y = y;
    ctx.putImageData(current,0,0);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) {
    canvas.addEventListener(type,event => {
      if (stroke?.pointer !== event.pointerId) return;
      if (!stroke.pan) savePainting();
      stroke = null;
    });
  }
}
