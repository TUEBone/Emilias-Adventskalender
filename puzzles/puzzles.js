import { puzzles } from './data.js';

export const puzzleKinds = {W:'Wortsuche', S:'Symbol-Sudoku', F:'Fehler finden', M:'Ausmalbild', G:'Geheimschrift', L:'Logikrätsel'};
export { puzzles };
const icons = {ball:'⚽', stern:'★', muetze:'🎅', schal:'🧣', trikot:'👕', kugel:'🔴', pokal:'🏆', paket:'🎁'};
const memory = new Map();
const imageUrl = file => new URL('images/' + file, import.meta.url).href;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, click, className) {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click',click);
  return node;
}

export async function mountPuzzle(root, puzzle, testing, signal) {
  const storageKey = 'emilia-advent-2026-puzzle-' + puzzle.day;
  const memoryKey = (testing ? 'test-' : '') + storageKey;
  let state = memory.get(memoryKey);
  if (!state && !testing) {
    try { state = JSON.parse(localStorage.getItem(storageKey)); } catch {}
  }
  state ??= {};
  const save = () => {
    memory.set(memoryKey,state);
    if (!testing) {
      try { localStorage.setItem(storageKey,JSON.stringify(state)); } catch {}
    }
  };
  const work = element('div',undefined,'puzzle-work');
  const feedback = element('p',state.solved ? 'Dieses Rätsel hast du schon gelöst.' : '', 'puzzle-feedback');
  feedback.setAttribute('role','status');
  root.replaceChildren(work,feedback);
  const report = text => { feedback.textContent = text; };
  const complete = (text = 'Richtig! Das Rätsel ist gelöst.') => {
    state.solved = true;
    save();
    report(text);
  };
  const tools = {state, save, report, complete};
  switch (puzzle.kind) {
    case 'W': wordSearch(work,puzzle,tools); break;
    case 'S': sudoku(work,puzzle,tools); break;
    case 'G': cipher(work,puzzle,tools); break;
    case 'L': logic(work,puzzle,tools); break;
    case 'F': differences(work,puzzle,tools); break;
    case 'M': {
      const { mountPaint } = await import('./paint.js');
      if (!signal.aborted) mountPaint(work,imageUrl(puzzle.image),tools,signal);
      break;
    }
  }
}

function wordSearch(root,puzzle,{state,save,report,complete}) {
  root.append(element('p','Tippe auf den Anfang und das Ende eines Worts. Gesucht wird nach rechts, nach unten, schräg nach rechts oben oder rechts unten.'));
  const list = element('ul',undefined,'word-list');
  const labels = new Map();
  for (const word of puzzle.words) {
    const label = element('li',word);
    labels.set(word,label);
    list.append(label);
  }
  const count = element('p',undefined,'puzzle-count');
  const grid = element('div',undefined,'word-grid');
  grid.style.setProperty('--columns',puzzle.grid[0].length);
  grid.setAttribute('role','group');
  grid.setAttribute('aria-label','Buchstabengitter');
  const cells = [];
  const found = new Set(state.words ?? []);
  let start = null;
  function select(row,col) {
    const chosen = cells[row][col];
    if (!start) {
      start = {row,col,node:chosen};
      chosen.setAttribute('aria-pressed','true');
      report('Wähle den letzten Buchstaben.');
      return;
    }
    start.node.setAttribute('aria-pressed','false');
    const [from, to] = [[start.row,start.col],[row,col]];
    start = null;
    if (from[0] === row && from[1] === col) {
      report('Die Auswahl ist aufgehoben.');
      return;
    }
    const word = puzzle.words.find(w => puzzle.positions[w].every(([r,c],i) => {
      const point = i ? to : from;
      return r === point[0] && c === point[1];
    }));
    if (!word) {
      report('Diese beiden Felder gehören zu keinem gesuchten Wort.');
      return;
    }
    if (found.has(word)) {
      report(word + ' hast du schon gefunden.');
      return;
    }
    found.add(word);
    state.words = [...found];
    save();
    showWord(word);
    updateCount();
    if (found.size === puzzle.words.length) complete('Alle Wörter gefunden!');
    else report(word + ' gefunden!');
  }
  for (const [row,letters] of puzzle.grid.entries()) {
    cells[row] = [];
    for (const [col,letter] of [...letters].entries()) {
      const cell = button(letter,()=>select(row,col));
      cell.setAttribute('aria-label',letter + ', Zeile ' + (row+1) + ', Spalte ' + (col+1));
      cell.setAttribute('aria-pressed','false');
      cells[row].push(cell);
      grid.append(cell);
    }
  }
  function showWord(word) {
    const [[r,c],[endR,endC]] = puzzle.positions[word];
    labels.get(word).classList.add('found');
    labels.get(word).setAttribute('aria-label',word + ', gefunden');
    for (let i=0;i<word.length;i++) {
      cells[r+i*Math.sign(endR-r)][c+i*Math.sign(endC-c)].classList.add('found');
    }
  }
  function updateCount() { count.textContent = found.size + ' / ' + puzzle.words.length + ' Wörtern gefunden'; }
  found.forEach(showWord);
  updateCount();
  root.append(list,count,grid);
}

function sudoku(root,puzzle,{state,save,report,complete}) {
  root.append(element('p','Jedes Motiv gehört genau einmal in jede Zeile, Spalte und jeden 2×3-Block. Tippe ein freies Feld an und wähle ein Symbol.'));
  const grid = element('div',undefined,'sudoku-grid');
  grid.setAttribute('role','group');
  grid.setAttribute('aria-label','Sudoku, sechs Zeilen und sechs Spalten');
  const controls = element('div',undefined,'sudoku-controls');
  const initial = puzzle.board;
  const board = state.board ?? initial.map(row=>[...row]);
  const cells = [];
  let selected = null;
  const label = value => value ? puzzle.symbols[value-1][1] : 'leer';
  function refresh(cell,r,c) {
    const value = board[r][c];
    cell.textContent = value ? icons[puzzle.symbols[value-1][0]] : '';
    cell.setAttribute('aria-label', 'Zeile ' + (r+1) + ', Spalte ' + (c+1) + ', ' + label(value));
  }
  for (const [row,values] of initial.entries()) {
    for (const [col,fixed] of values.entries()) {
      const cell = button('',()=>{
        selected?.node.setAttribute('aria-pressed','false');
        selected = {row,col,node:cell};
        cell.setAttribute('aria-pressed','true');
        report('Wähle ein Symbol für das markierte Feld.');
      });
      cell.disabled = Boolean(fixed);
      if (!fixed) cell.setAttribute('aria-pressed','false');
      refresh(cell,row,col);
      if (col === 2) cell.classList.add('block-right');
      if (row === 1 || row === 3) cell.classList.add('block-bottom');
      cells.push(cell);
      grid.append(cell);
    }
  }
  function assign(value) {
    if (!selected) { report('Wähle zuerst ein freies Feld.'); return; }
    const {row,col,node} = selected;
    board[row][col] = value;
    state.board = board;
    refresh(node,row,col);
    save();
    report('');
    if (board.every((line,r)=>line.every((v,c)=>v===puzzle.answer[r][c]))) complete();
  }
  puzzle.symbols.forEach(([icon,name],i)=>{
    const option = button(icons[icon],()=>assign(i+1));
    option.title = name;
    option.setAttribute('aria-label',name);
    controls.append(option);
  });
  controls.append(button('Feld leeren',()=>assign(0)));
  root.append(grid,controls,button('Lösung prüfen',()=>{
    if (board.some(row=>row.includes(0))) report('Es sind noch Felder frei.');
    else if (board.every((row,r)=>row.every((value,c)=>value===puzzle.answer[r][c]))) complete();
    else report('Einige Symbole passen noch nicht. Prüfe Zeilen, Spalten und Blöcke.');
  }));
}

function cipher(root,puzzle,{state,save,report,complete}) {
  root.append(element('p','Ersetze jede Zahl durch den passenden Buchstaben aus dem Schlüssel und gib die ganze Nachricht ein.'));
  const key = element('dl',undefined,'cipher-key');
  for (const [letter,number] of Object.entries(puzzle.key).sort((a,b)=>a[1]-b[1])) {
    const item = element('div');
    item.append(element('dt',number),element('dd',letter));
    key.append(item);
  }
  const encoded = element('div',undefined,'cipher-message');
  for (const word of puzzle.answer.split(' ')) {
    const group = element('span', [...word].map(letter=>puzzle.key[letter]).join(' '));
    encoded.append(group);
  }
  const form = element('form',undefined,'check-form');
  const label = element('label','Deine Nachricht');
  const field = element('input');
  field.type = 'text';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.value = state.text ?? '';
  label.append(field);
  const submit = element('button','Nachricht prüfen');
  submit.type = 'submit';
  field.addEventListener('input',()=>{
    state.text = field.value;
    save();
  });
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const normalize = value => value.trim().replace(/[^\p{L}\s]/gu,'').replace(/\s+/g,' ').toLocaleUpperCase('de');
    if (normalize(field.value) === normalize(puzzle.answer)) complete('Die Nachricht ist entschlüsselt!');
    else report('Die Nachricht stimmt noch nicht ganz. Vergleiche sie mit dem Schlüssel.');
  });
  form.append(label,submit);
  root.append(key,encoded,form);
}

function logic(root,puzzle,{state,save,report,complete}) {
  root.append(element('p','Jede Möglichkeit passt genau einmal. Lies die Hinweise und ordne jeder Person drei Antworten zu.'));
  const clues = element('ol',undefined,'logic-clues');
  puzzle.clues.forEach(clue=>clues.append(element('li',clue)));
  root.append(clues);
  const form = element('form',undefined,'check-form logic-form');
  const chosen = state.chosen ?? puzzle.answer.map(()=>['','','']);
  puzzle.answer.forEach(([person],row)=>{
    const group = element('fieldset');
    group.append(element('legend',person));
    puzzle.headers.forEach((header,col)=>{
      const label = element('label',header);
      const select = element('select');
      const empty = element('option','Auswählen');
      empty.value = '';
      select.append(empty);
      puzzle.options[col].forEach(option=>select.append(element('option',option)));
      select.value = chosen[row][col];
      select.addEventListener('change',()=>{
        chosen[row][col] = select.value;
        state.chosen = chosen;
        save();
      });
      label.append(select);
      group.append(label);
    });
    form.append(group);
  });
  const submit = element('button','Zuordnung prüfen');
  submit.type = 'submit';
  form.append(submit);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if (chosen.some(row=>row.includes(''))) return report('Fülle zuerst alle Felder aus.');
    if (chosen.every((row,r)=>row.every((value,c)=>value===puzzle.answer[r][c+1]))) complete();
    else report('Die Zuordnung stimmt noch nicht ganz. Prüfe die Hinweise noch einmal.');
  });
  root.append(form);
}

function differences(root,puzzle,{state,save,report,complete}) {
  root.append(element('p','Vergleiche die beiden Zeichnungen. Tippe in Bild B auf die zehn Stellen, die sich verändert haben.'));
  const found = new Set(state.areas ?? []);
  const count = element('p',undefined,'puzzle-count');
  const pair = element('div',undefined,'difference-pair');
  const targets = [];
  function update() { count.textContent = found.size + ' / ' + puzzle.areas.length + ' Unterschiede gefunden'; }
  function hit(index) {
    if (found.has(index)) return;
    found.add(index);
    state.areas = [...found];
    save();
    targets[index].classList.add('found');
    targets[index].setAttribute('aria-label','Gefundener Unterschied ' + found.size);
    update();
    if (found.size === puzzle.areas.length) complete('Alle zehn Unterschiede gefunden!');
    else report('Richtig, dort ist ein Unterschied.');
  }
  for (const [i,file] of puzzle.images.entries()) {
    const figure = element('figure');
    figure.append(element('figcaption',i ? 'Bild B' : 'Bild A'));
    const plate = element('div',undefined,'difference-image');
    const img = element('img');
    img.alt = i ? 'Vergleichsbild mit zehn Unterschieden' : 'Originalzeichnung';
    img.width = puzzle.width;
    img.height = puzzle.height;
    img.src = imageUrl(file);
    plate.append(img);
    if (i === 1) {
      puzzle.areas.forEach(([x0,y0,x1,y1],index)=>{
        const target = button('',()=>hit(index),'difference-target');
        const w = puzzle.width, h = puzzle.height;
        target.style.left = 100*(x0+x1)/2/w + '%';
        target.style.top = 100*(y0+y1)/2/h + '%';
        target.style.width = 100*(x1-x0+7)/w + '%';
        target.style.height = 100*(y1-y0+7)/h + '%';
        target.setAttribute('aria-label','Stelle in Bild B prüfen');
        if (found.has(index)) {
          target.classList.add('found');
          target.setAttribute('aria-label','Gefundener Unterschied');
        }
        plate.append(target);
        targets.push(target);
      });
      plate.addEventListener('click',event=>{
        if (event.target === img) report('Dort wurde kein Unterschied gefunden.');
      });
    }
    figure.append(plate);
    pair.append(figure);
  }
  update();
  root.append(count,pair);
}
