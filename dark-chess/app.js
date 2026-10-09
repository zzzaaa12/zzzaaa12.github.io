/* Browser controller: all moves go through the shared rule engine. */
(() => {
  'use strict';
  const E = window.DarkChess;
  const $ = id => document.getElementById(id);
  const icons = {
    book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15"/>',
    mute: '<path d="M11 4 6 8H3v8h3l5 4V4Z"/><path d="m16 9 5 6m0-6-5 6"/>',
    sound: '<path d="M11 4 6 8H3v8h3l5 4V4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    bulb: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/><path d="M12 1V0M3 5 1 4m20 0-2 1"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-4"/>',
    refresh: '<path d="M20 8a9 9 0 1 0 1 7M20 3v5h-5"/>',
    sprout: '<path d="M12 22V11M12 15C4 15 3 9 4 6c5 0 8 3 8 9Zm0-5C12 4 16 2 21 2c0 5-3 9-9 8Z"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 4 7 4 8 0M8 8v1m8-1v1"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    heart: '<path d="M12 20S2 14 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 6-10 12-10 12Z"/>',
    flag: '<path d="M5 22V3c5-4 9 4 14 0v12c-5 4-9-4-14 0"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>'; }
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
  const STORAGE = 'little-dark-chess-v1';
  let state = E.create(), history = [], difficulty = 'standard', mode = 'computer', sound = false;
  let selected = null, suggestion = null, aiTimer = null, arrowTimer = null, context = null, storageOK = true;
  const capturedRotation = { red: 0, black: 0 };
  let boardRotation = 0, playSpeed = 'slow', soundVolume = .8;
  let replayBusy = false, replayBoard = null;
  let renderedCaptureCount = 0;
  let restored = false, aiReview = false, moveAnimation = null;
  let activeSearch = null, hintBusy = false, revision = 0;
  function cancelSearch() {
    revision++;
    replayBusy = false; replayBoard = null;
    moveAnimation?.cancel(); moveAnimation = null;
    if (activeSearch) activeSearch.cancel();
    activeSearch = null; hintBusy = false;
  }
  function searchPosition(side, level) {
    const publicPosition = E.publicBoard(state.board);
    const repetitions = {};
    for (const [key, count] of Object.entries(state.positions)) {
      const split = key.indexOf(':');
      const color = key.slice(0, split) === 'human' ? state.humanSide : E.other(state.humanSide);
      if (color) repetitions[color + key.slice(split)] = count;
    }
    const options = { captured: state.captured.map(p => ({ ...p })), quiet: state.quiet, repetitions };
    return new Promise(resolve => {
      let worker = null, url = null, timer = null, done = false;
      const finish = result => {
        if (done) return; done = true;
        clearTimeout(timer); worker?.terminate(); if (url) URL.revokeObjectURL(url);
        if (activeSearch === task) activeSearch = null;
        resolve(result);
      };
      const task = { cancel: () => finish(null) };
      if (activeSearch) activeSearch.cancel();
      activeSearch = task;
      const fallback = () => {
        worker?.terminate();
        timer = setTimeout(() => { if (!done) finish(E.analyze(publicPosition, side, level, { ...options, timeMs: 120, maxNodes: 2200 })); }, 0);
      };
      try {
        const source = E.workerSource + '\nonmessage = function(e) { const d=e.data; postMessage(DarkChess.analyze(d.board,d.side,d.level,d.options)); };';
        url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        worker = new Worker(url);
        worker.onmessage = event => finish(event.data);
        worker.onerror = event => { event.preventDefault(); clearTimeout(timer); fallback(); };
        worker.postMessage({ board: publicPosition, side, level, options });
        timer = setTimeout(fallback, 5000);
      } catch { fallback(); }
    });
  }
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.version === 1 && E.validState(saved.state)) {
        state = saved.state;
        history = Array.isArray(saved.history) ? saved.history.filter(E.validState).slice(-25) : [];
        difficulty = ['practice', 'standard', 'challenge'].includes(saved.difficulty) ? saved.difficulty : 'standard';
        mode = saved.mode === 'two-player' ? 'two-player' : 'computer';
        sound = saved.sound === true;
        if ([0, 90, 180, 270].includes(saved.boardRotation)) boardRotation = saved.boardRotation;
        if (['slow', 'normal'].includes(saved.playSpeed)) playSpeed = saved.playSpeed;
        if (Number.isFinite(saved.soundVolume) && saved.soundVolume >= 0 && saved.soundVolume <= 1) soundVolume = saved.soundVolume;
        for (const side of ['red', 'black']) {
          const angle = saved.capturedRotation?.[side];
          if ([0, 90, 180, 270].includes(angle)) capturedRotation[side] = angle;
        }
        restored = state.ply > 0;
      }
    }
  } catch { storageOK = false; }
  const mobile = window.matchMedia('(max-width: 43.99rem)');
  const sideLabel = side => side === 'red' ? '紅隊' : '黑隊';
  const playerName = actor => mode === 'two-player' ? (actor === 'human' ? '小虎' : '小龍') : (actor === 'human' ? '你' : '小虎');
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const save = () => {
    try { localStorage.setItem(STORAGE, JSON.stringify({ version: 1, state, history, difficulty, mode, sound, capturedRotation, boardRotation, playSpeed, soundVolume })); storageOK = true; }
    catch { storageOK = false; }
    $('saveNote').lastElementChild.textContent = storageOK ? '進度會自動保存，可以放心休息' : '這個瀏覽器無法存檔；請保持頁面開啟';
  };
  function tone(kind = 'move') {
    if (!sound) return;
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      const play = () => {
        if (!sound || context.state !== 'running') return;
        // A noisy contact transient and damped wooden resonances form each tap.
        const tap = (delay, strength, pitch = 1) => {
          const at = context.currentTime + delay;
          const duration = .16;
          const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
          const samples = buffer.getChannelData(0);
          let smooth = 0;
          for (let i = 0; i < samples.length; i++) {
            const t = i / context.sampleRate;
            const noise = Math.random() * 2 - 1;
            smooth = smooth * .5 + noise * .5;
            const contact = smooth * Math.exp(-t * 210) * .65;
            const body = Math.sin(2 * Math.PI * 540 * pitch * t) * Math.exp(-t * 65) * .32
              + Math.sin(2 * Math.PI * 1120 * pitch * t) * Math.exp(-t * 95) * .15
              + Math.sin(2 * Math.PI * 1840 * pitch * t) * Math.exp(-t * 140) * .08;
            const attack = Math.min(1, t / .0008);
            samples[i] = (contact + body) * attack * Math.min(1, (duration - t) / .01);
          }
          const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
          source.buffer = buffer;
          filter.type = 'lowpass'; filter.frequency.value = 3800; filter.Q.value = .5;
          gain.gain.value = strength * soundVolume;
          source.connect(filter); filter.connect(gain); gain.connect(context.destination);
          source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
          source.start(at);
        };
        if (kind === 'flip') { tap(0, .26, 1.3); tap(.11, .65, 1.08); }
        else if (kind === 'capture') { tap(0, .24, 1.2); tap(.085, .9, .88); }
        else tap(0, .75, 1);
      };
      if (context.state === 'suspended') context.resume().then(play).catch(() => {});
      else play();
    } catch { /* Sound is optional; gameplay always continues. */ }
  }
  function coach(title, text) {
    $('coachTitle').textContent = title;
    $('coachText').textContent = text;
    $('mobileCoachTitle').textContent = title;
    $('mobileCoachText').textContent = text;
    $('tiger').classList.remove('happy');
    requestAnimationFrame(() => $('tiger').classList.add('happy'));
  }
  function pieceHTML(p) {
    if (p.hidden) return '<span class="piece covered"><span class="cover-flower"></span></span>';
    return '<span class="piece ' + p.side + '">' + '<span class="board-glyph">' + E.name(p) + '</span></span>';
  }
  const visualOrder = () => Array.from({ length: 32 }, (_, i) => mobile.matches ? (3 - i % 4) * 8 + Math.floor(i / 4) : i);
  function location(i) { const v = visualOrder().indexOf(i), cols = mobile.matches ? 4 : 8; return '第 ' + (Math.floor(v / cols) + 1) + ' 列、第 ' + (v % cols + 1) + ' 格'; }
  function direction(from, to) {
    const order = visualOrder(), a = order.indexOf(from), b = order.indexOf(to), cols = mobile.matches ? 4 : 8;
    return Math.floor(a / cols) === Math.floor(b / cols) ? (b > a ? '右' : '左') : (b > a ? '下' : '上');
  }
  function render() {
    const currentSide = state.humanSide ? (state.turn === 'human' ? state.humanSide : E.other(state.humanSide)) : null;
    const interactive = (mode === 'two-player' || state.turn === 'human') && !state.result && !replayBusy;
    $('board').style.setProperty('--board-angle', boardRotation + 'deg');
    $('boardRotate').setAttribute('aria-label', '旋轉棋盤棋字，目前 ' + boardRotation + ' 度');
    $('playSpeed').value = playSpeed;
    $('soundVolume').value = Math.round(soundVolume * 100);
    $('volumeValue').textContent = Math.round(soundVolume * 100) + '%';
    $('replayButton').disabled = mode === 'two-player' || replayBusy || state.turn !== 'human' || state.last?.actor !== 'ai';
    $('replayButton').textContent = replayBusy ? '正在重播…' : '再看一次';
    const all = E.actions(state.board, currentSide);
    const froms = new Set(all.filter(a => a.kind === 'move').map(a => a.from));
    const targets = new Set(all.filter(a => a.kind === 'move' && a.from === selected).map(a => a.to));
    const focusIndex = document.activeElement?.dataset.index;
    $('board').replaceChildren();
    for (const i of visualOrder()) {
      const p = (replayBoard || state.board)[i], button = document.createElement('button');
      button.type = 'button'; button.className = 'cell'; button.dataset.index = i;
      if (p) button.innerHTML = pieceHTML(p);
      button.setAttribute('aria-label', location(i) + '，' + (!p ? '空格' : p.hidden ? '未翻開的棋子' : sideLabel(p.side) + E.name(p)) + (interactive && targets.has(i) ? p ? '，可以吃' : '，可以走' : ''));
      button.setAttribute('aria-pressed', String(selected === i));
      button.setAttribute('aria-disabled', String(!interactive));
      if (interactive && p?.hidden) button.classList.add('can-flip');
      if (interactive && froms.has(i)) button.classList.add('available');
      if (selected === i) button.classList.add('selected');
      if (interactive && targets.has(i)) button.classList.add(p ? 'capture' : 'legal');
      if (suggestion && (suggestion.to === i || suggestion.from === i)) button.classList.add('suggested');
      if (state.last?.to === i) button.classList.add('last');
      if (!replayBusy && aiReview && state.last?.actor === 'ai') {
        if (state.last.from === i) button.classList.add('ai-origin');
        if (state.last.to === i) button.classList.add('ai-destination');
      }
      button.addEventListener('click', () => clickCell(i));
      button.addEventListener('keydown', boardKeys);
      $('board').append(button);
    }
    if (focusIndex !== undefined) $('board').querySelector('[data-index="' + focusIndex + '"]')?.focus({ preventScroll: true });
    $('moveCount').textContent = '第 ' + (Math.floor(state.ply / 2) + 1) + ' 回合';
    const turnText = replayBusy ? '再看一次小虎的動作' : state.result ? '這一局完成了' : state.turn === 'ai' ? '小虎想一想…' : '輪到你了';
    $('turnBadge').innerHTML = mode === 'two-player' && !state.result
      ? '<span class="turn-avatar ' + (state.turn === 'human' ? 'tiger' : 'dragon') + '" aria-hidden="true">' + (state.turn === 'human' ? '虎' : '龍') + '</span><span>輪到' + playerName(state.turn) + '</span>'
      : '<span class="turn-indicator"></span><span>' + turnText + '</span>';
    $('turnBadge').classList.toggle('thinking', mode === 'computer' && state.turn === 'ai' && !state.result);
    $('humanSide').textContent = state.humanSide ? (mode === 'two-player' ? '小虎 · ' : '你是') + sideLabel(state.humanSide) + ' · 剩下 ' + (16 - state.captured.filter(p => p.side === state.humanSide).length) + ' 顆' : '翻一顆棋，決定先手的顏色';
    $('firstPlayerName').innerHTML = mode === 'two-player' ? '小虎' : '小小棋手 <span class="you-label">你</span>';
    $('opponentName').textContent = mode === 'two-player' ? '小龍' : '小虎棋友';
    $('opponentAvatar').textContent = mode === 'two-player' ? '龍' : '虎';
    const playerTeams = [[$('firstPlayerName'), $('firstPlayerAvatar')], [$('opponentName'), $('opponentAvatar')]];
    const assignedTeams = [state.humanSide, state.humanSide ? E.other(state.humanSide) : null];
    playerTeams.forEach((pair, index) => pair.forEach(el => {
      el.classList.toggle('team-red', assignedTeams[index] === 'red');
      el.classList.toggle('team-black', assignedTeams[index] === 'black');
    }));
    $('aiSide').textContent = state.humanSide ? (mode === 'two-player' ? '小龍 · ' : '') + sideLabel(E.other(state.humanSide)) + ' · 剩下 ' + (16 - state.captured.filter(p => p.side !== state.humanSide).length) + ' 顆' : mode === 'two-player' ? '等待小虎翻棋' : '陪你一起練習';
    const hidden = state.board.filter(p => p?.hidden).length;
    $('remaining').textContent = hidden ? '還有 ' + hidden + ' 顆沒翻開' : '所有棋子都翻開了';
    $('hintButton').disabled = mode === 'two-player' || !interactive || hintBusy;
    $('hintButton').innerHTML = icon('bulb') + (hintBusy ? '幫你想一步…' : mode === 'two-player' ? '兩人對戰' : '給我提示');
    $('undoButton').disabled = (mode === 'computer' && difficulty === 'challenge') || !history.length;
    $('undoButton').title = mode === 'computer' && difficulty === 'challenge' ? '挑戰模式不提供悔棋；可切換成入門或標準' : !history.length ? '走過一步，就可以悔棋' : '回到上一步開始前';
    $('gameMode').value = mode === 'two-player' ? mode : difficulty;
    $('soundButton').innerHTML = icon(sound ? 'sound' : 'mute');
    $('soundButton').setAttribute('aria-label', sound ? '關閉音效' : '開啟音效');
    $('soundButton').setAttribute('aria-pressed', String(sound));
    for (const side of ['red', 'black']) {
      const el = $(side + 'Captured'), pieces = state.captured.filter(p => p.side === side);
      el.style.setProperty('--captured-angle', capturedRotation[side] + 'deg');
      $(side + 'Rotate').setAttribute('aria-label', '旋轉' + (side === 'red' ? '紅' : '黑') + '棋休息區的棋字，目前 ' + capturedRotation[side] + ' 度');
      el.innerHTML = pieces.length ? pieces.map((p, index) => '<span class="mini-piece ' + side + (state.captured.length > renderedCaptureCount && index === pieces.length - 1 && state.last?.captured?.side === side && state.last.captured.type === p.type ? ' just-captured' : '') + '" aria-label="' + sideLabel(side) + E.name(p) + '">' + '<span class="captured-glyph">' + E.name(p) + '</span></span>').join('') : '<small>還沒有棋子休息</small>';
    }
    renderedCaptureCount = state.captured.length;
    $('moveArrow').style.display = 'none';
    if (aiReview && state.last?.actor === 'ai' && state.last.kind === 'move') requestAnimationFrame(drawArrow);
  }
  function boardKeys(event) {
    const order = visualOrder(), v = order.indexOf(Number(event.currentTarget.dataset.index)), cols = mobile.matches ? 4 : 8;
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const next = v + steps[event.key];
    if (next < 0 || next >= 32 || (event.key === 'ArrowLeft' && v % cols === 0) || (event.key === 'ArrowRight' && v % cols === cols - 1)) return;
    $('board').querySelector('[data-index="' + order[next] + '"]').focus();
  }
  function drawArrow() {
    const a = state.last;
    if (!aiReview || !a || a.kind !== 'move' || a.actor !== 'ai') return;
    const from = $('board').querySelector('[data-index="' + a.from + '"]').getBoundingClientRect();
    const to = $('board').querySelector('[data-index="' + a.to + '"]').getBoundingClientRect();
    const frame = $('moveArrow').parentElement.getBoundingClientRect();
    const line = $('arrowLine');
    line.setAttribute('x1', from.x + from.width / 2 - frame.x - 2); line.setAttribute('y1', from.y + from.height / 2 - frame.y - 2);
    line.setAttribute('x2', to.x + to.width / 2 - frame.x - 2); line.setAttribute('y2', to.y + to.height / 2 - frame.y - 2);
    $('moveArrow').style.display = 'block';
    clearTimeout(arrowTimer);
  }
  function baseCoach() {
    if (state.result) { coach(state.result.winner === 'draw' ? '握握手，這局和棋！' : mode === 'two-player' ? playerName(state.result.winner) + ' 獲勝！' : state.result.winner === 'human' ? '你完成了這場挑戰！' : '這次讓小虎先贏一局', state.lesson || '每一局都是新的練習。下次再一起想想不同的走法！'); return; }
    if (mode === 'two-player') { coach('輪到' + playerName(state.turn), '請由' + playerName(state.turn) + '操作。小虎先翻的第一顆棋，決定小虎的隊伍。'); return; }
    if (state.turn === 'ai') { coach('換小虎想一想', '看看棋面，猜猜我下一步會怎麼走？'); return; }
    if (!state.humanSide) { coach('嗨！先翻一顆棋吧', '我是小虎！點一顆綠色的棋子，看看你會加入紅隊還是黑隊。'); return; }
    const last = state.last;
    const intro = last?.actor === 'ai' ? last.kind === 'flip' ? '我翻開了' + sideLabel(last.piece.side) + '的「' + E.name(last.piece) + '」。' : '我把「' + E.name(last.piece) + '」往' + direction(last.from, last.to) + (last.captured ? '移動，吃掉了「' + E.name(last.captured) + '」。' : '移動了。') : '';
    coach('輪到你了，' + sideLabel(state.humanSide) + '小棋手', intro + '點自己的棋，看看能走哪裡；也可以翻一顆蓋牌。');
  }
  function clickCell(i) {
    if (replayBusy) return;
    if (state.result) { baseCoach(); return; }
    if (mode !== 'two-player' && state.turn !== 'human') { coach('等小虎走完這一步', '馬上就輪到你了，可以先看看棋面。'); return; }
    aiReview = false;
    $('moveArrow').style.display = 'none';
    $('board').querySelectorAll('.ai-origin, .ai-destination').forEach(el => el.classList.remove('ai-origin', 'ai-destination'));
    const p = state.board[i];
    const currentSide = state.humanSide ? (state.turn === 'human' ? state.humanSide : E.other(state.humanSide)) : null;
    if (selected !== null && E.canMove(state.board, selected, i, currentSide)) { perform({ kind: 'move', from: selected, to: i }); return; }
    if (p?.hidden) { perform({ kind: 'flip', to: i }); return; }
    suggestion = null;
    if (p && p.side === currentSide) {
      if (selected === i) { selected = null; render(); baseCoach(); return; }
      selected = i;
      const moves = E.actions(state.board, currentSide).filter(a => a.kind === 'move' && a.from === i);
      render();
      coach('你選了「' + E.name(p) + '」', moves.length ? '綠色圓點可以走，紅色「吃」框可以吃。' + (p.type === 'cannon' ? '炮吃棋時，要隔著恰好一顆棋。' : '點一個標記的位置，完成這一步。') : '這顆棋暫時走不了。試試另一顆自己的棋，或翻開一顆蓋牌。');
    } else if (selected !== null) {
      const source = state.board[selected];
      coach('這一步還不能走喔', !p ? '一般移動只能上下左右走一格。請選有綠色圓點的位置。' : source.type === 'cannon' ? '炮要在同一直線上，隔著恰好一顆棋才能吃。' : '要相鄰，而且吃得動對方才行。試試有「吃」標記的棋。');
    } else coach(p ? (mode === 'two-player' ? '這是對方的棋子' : '這是小虎的棋子') : '先選一顆自己的棋', p ? '找找' + sideLabel(currentSide) + '的棋，或翻一顆綠色的蓋牌。' : '點自己的棋，再點綠色圓點，就能移動囉。');
  }
  function perform(action) {
    cancelSearch();
    const wasHuman = state.turn === 'human';
    if (wasHuman || mode === 'two-player') { history.push(snapshot()); if (history.length > 25) history.shift(); }
    state = E.apply(state, action);
    aiReview = mode === 'computer' && !wasHuman;
    selected = null; suggestion = null;
    tone(action.kind === 'flip' ? 'flip' : state.last.captured ? 'capture' : 'move');
    render(); baseCoach(); save();
    if (state.result) showResult(); else if (mode === 'computer') scheduleAI();
  }
  async function presentAI(action, token, board = state.board) {
    const cell = i => $('board').querySelector('[data-index="' + i + '"]');
    const source = cell(action.kind === 'flip' ? action.to : action.from);
    const target = cell(action.to);
    source.classList.add('ai-preview');
    if (action.kind === 'flip') coach('看小虎翻這一顆', '亮起來的這顆棋，準備翻開囉。');
    else {
      const p = board[action.from], q = board[action.to];
      target.classList.add(q ? 'ai-capture-preview' : 'ai-preview');
      coach('看看小虎這一步', '小虎要把「' + E.name(p) + '」往' + direction(action.from, action.to) + '移動' + (q ? '，吃掉你的「' + E.name(q) + '」。' : '一格。'));
    }
    await new Promise(resolve => setTimeout(resolve, playSpeed === 'slow' ? 700 : 300));
    if (token !== revision || document.querySelector('dialog[open]')) return;
    const piece = source.querySelector('.piece');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (piece && !reduced) {
      let frames;
      if (action.kind === 'flip') frames = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(85deg)' }];
      else {
        const a = source.getBoundingClientRect(), b = target.getBoundingClientRect();
        source.style.zIndex = '4';
        frames = [{ transform: 'translate(0, 0)' }, { transform: 'translate(' + (b.x - a.x) + 'px, ' + (b.y - a.y) + 'px)' }];
      }
      const animation = piece.animate(frames, { duration: (action.kind === 'flip' ? 600 : 1000) * (playSpeed === 'slow' ? 1 : .6), easing: 'ease-in-out', fill: 'forwards' });
      moveAnimation = animation;
      try { await animation.finished; } catch { /* A new game or undo cancels the presentation. */ }
      if (moveAnimation === animation) moveAnimation = null;
    } else await new Promise(resolve => setTimeout(resolve, playSpeed === 'slow' ? 1000 : 600));
  }
  function scheduleAI() {
    clearTimeout(aiTimer);
    if (mode === 'two-player' || state.turn !== 'ai' || state.result) return;
    aiTimer = setTimeout(async () => {
      // Pause for reading rules or practising in the separate tutorial.
      if (document.querySelector('dialog[open]')) { scheduleAI(); return; }
      const token = revision;
      const result = await searchPosition(E.other(state.humanSide), difficulty);
      if (token !== revision || state.turn !== 'ai' || state.result) return;
      if (document.querySelector('dialog[open]')) { scheduleAI(); return; }
      if (result?.action) {
        await presentAI(result.action, token);
        if (token !== revision || state.turn !== 'ai' || state.result) return;
        if (document.querySelector('dialog[open]')) { render(); baseCoach(); scheduleAI(); return; }
        perform(result.action);
      }
    }, playSpeed === 'slow' ? 1800 : 800);
  }
  async function hint() {
    if (mode === 'two-player' || state.turn !== 'human' || state.result || hintBusy || replayBusy) return;
    aiReview = false; hintBusy = true; render();
    const token = revision;
    const result = await searchPosition(state.humanSide, 'standard');
    if (token !== revision || state.turn !== 'human' || state.result) return;
    hintBusy = false;
    suggestion = result?.action;
    if (!suggestion) { render(); return; }
    if (!suggestion) return;
    selected = suggestion.kind === 'move' ? suggestion.from : null;
    render();
    if (suggestion.kind === 'flip') coach('試著翻開這一顆', '我用虛線框幫你圈起來了。' + result.reason);
    else {
      const p = state.board[suggestion.from], target = state.board[suggestion.to], after = E.moved(E.publicBoard(state.board), suggestion);
      const risk = E.threatened(after, suggestion.to, state.humanSide);
      const reason = target ? p.type === 'cannon' ? '中間剛好隔著一顆棋，炮可以吃掉它。' : p.type === 'pawn' && target.type === 'king' ? '小兵的特別本領，就是可以吃將！' : '你的棋和它一樣大或更大，可以吃掉它。' : E.threatened(E.publicBoard(state.board), suggestion.from, state.humanSide) ? '原本的位置可能被吃，試著移開。' : '先調整位置，看看接下來有沒有機會。';
      coach(target ? '可以用「' + E.name(p) + '」吃「' + E.name(target) + '」' : '「' + E.name(p) + '」可以往' + direction(suggestion.from, suggestion.to) + '走', (target ? reason : result.reason) + (risk ? '不過，要注意：走過去後可能被已翻開的對手棋吃掉。' : '這是根據已翻開棋面的建議，你也可以自己選。'));
    }
  }
  function undo() {
    if ((mode === 'computer' && difficulty === 'challenge') || !history.length) return;
    cancelSearch();
    clearTimeout(aiTimer); clearTimeout(arrowTimer);
    aiReview = false; state = history.pop(); selected = null; suggestion = null;
    render(); save(); coach('回到剛剛，再想一次', mode === 'two-player' ? '已回到上一手之前，小虎和小龍可以重新思考。' : '已回到你上一步開始前，小虎剛才那一步也一起收回。這次想試試哪一步？');
  }
  function newGame() {
    cancelSearch();
    clearTimeout(aiTimer); clearTimeout(arrowTimer);
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    aiReview = false; state = E.create(); history = []; selected = null; suggestion = null;
    render(); baseCoach(); save();
  }
  function showResult() {
    $('resultTitle').textContent = state.result.winner === 'draw' ? '不分上下，握手和棋！' : mode === 'two-player' ? playerName(state.result.winner) + ' 獲勝！' : state.result.winner === 'human' ? '這一局，你贏了！' : '小虎贏了，下次再挑戰！';
    $('resultReason').textContent = state.result.reason;
    $('resultLesson').textContent = state.lesson || '你完成了 ' + Math.ceil(state.ply / 2) + ' 回合的思考。願意再試一次，就是很棒的進步。';
    $('resultDialog').showModal();
  }
  function openDialog(id) { if (!$(id).open) $(id).showModal(); }
  document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', event => { const r = d.getBoundingClientRect(); if (event.target === d && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) d.close(); }));
  $('rulesButton').onclick = $('moreRules').onclick = () => openDialog('rulesDialog');
  $('settingsButton').onclick = () => openDialog('settingsDialog');
  $('hintButton').onclick = hint;
  $('undoButton').onclick = undo;
  $('newButton').onclick = () => state.ply ? openDialog('newDialog') : newGame();
  $('confirmNew').onclick = $('playAgain').onclick = newGame;
  $('gameMode').onchange = event => {
    cancelSearch(); clearTimeout(aiTimer);
    if (event.target.value === 'two-player') mode = 'two-player';
    else { mode = 'computer'; difficulty = event.target.value; }
    state = E.create(); history = []; selected = null; suggestion = null;
    render(); save();
    if (mode === 'two-player') { coach('小虎和小龍來對戰！', '小虎先翻一顆棋，翻出的顏色就是小虎的隊伍。之後小虎和小龍輪流操作。'); return; }
    const descriptions = { practice: ['入門：一起慢慢想', '小虎會保護自己的棋，不會故意亂送。可以使用提示和悔棋。'], standard: ['標準：多想幾步', '小虎會預想接下來的交換與危險。可以使用提示和悔棋。'], challenge: ['挑戰：小虎認真了', '小虎會想得更深，尤其是棋子變少的時候。不能悔棋，但仍可使用提示。'] };
    coach(...descriptions[difficulty]); scheduleAI();
  };
  for (const side of ['red', 'black']) {
    $(side + 'Rotate').onclick = () => {
      capturedRotation[side] = (capturedRotation[side] + 90) % 360;
      const el = $(side + 'Captured');
      el.style.setProperty('--captured-angle', capturedRotation[side] + 'deg');
      $(side + 'Rotate').setAttribute('aria-label', '旋轉' + (side === 'red' ? '紅' : '黑') + '棋休息區的棋字，目前 ' + capturedRotation[side] + ' 度');
      save();
    };
  }
  $('boardRotate').onclick = () => {
    boardRotation = (boardRotation + 90) % 360;
    $('board').style.setProperty('--board-angle', boardRotation + 'deg');
    $('boardRotate').setAttribute('aria-label', '旋轉棋盤棋字，目前 ' + boardRotation + ' 度');
    save();
  };
  $('playSpeed').onchange = event => { playSpeed = event.target.value; save(); };
  $('soundVolume').oninput = event => {
    soundVolume = Number(event.target.value) / 100;
    $('volumeValue').textContent = event.target.value + '%'; save();
  };
  $('soundVolume').onchange = () => tone('move');
  $('replayButton').onclick = async () => {
    if (replayBusy || state.turn !== 'human' || state.last?.actor !== 'ai') return;
    cancelSearch();
    const token = revision, action = state.last;
    const before = state.board.map(p => p ? { ...p } : null);
    if (action.kind === 'flip') before[action.to].hidden = true;
    else { before[action.from] = { ...action.piece }; before[action.to] = action.captured ? { ...action.captured } : null; }
    replayBusy = true; replayBoard = before; selected = null; suggestion = null;
    render();
    await presentAI(action, token, before);
    if (token !== revision) return;
    replayBusy = false; replayBoard = null; aiReview = true;
    render(); baseCoach();
    tone(action.kind === 'flip' ? 'flip' : action.captured ? 'capture' : 'move');
  };
  $('soundButton').onclick = () => { sound = !sound; tone('flip'); render(); save(); };
  $('fullRanks').innerHTML = E.TYPES.map(t => '<span><span class="mini-piece">' + t.black + '</span>' + t.red + '／' + t.black + '</span>').join('');
  // Three isolated, interactive lessons. No tutorial action touches game state.
  let lesson = 0, lessonDone = false, lessonPicked = false;
  const lessonData = [
    { title: '第一步：翻開一顆棋', text: '點中間那顆綠色的棋子，看看裡面是誰。', finish: '翻到紅色的兵！正式對局中，第一顆棋的顏色就是你的隊伍。' },
    { title: '第二步：往旁邊走一格', text: '先點紅色的俥，再點右邊的虛線空格。', finish: '走對了！每次可以上下左右走一格，不能斜走。' },
    { title: '第三步：吃掉對方的棋', text: '先點紅色的俥，再點右邊黑色的馬。', finish: '成功吃棋！車比馬大，所以可以吃掉馬。你已經準備好囉！' }
  ];
  function renderLesson() {
    const data = lessonData[lesson];
    $('lessonProgress').textContent = '小虎練習場 · ' + (lesson + 1) + ' / 3';
    $('lessonTitle').textContent = data.title; $('lessonText').textContent = data.text;
    $('lessonFeedback').textContent = lessonDone ? data.finish : '點一點，試試看！';
    $('lessonNext').disabled = !lessonDone; $('lessonNext').textContent = lesson === 2 ? '我會了，開始玩！' : '下一個練習';
    $('lessonBoard').replaceChildren();
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.lessonIndex = i;
      let p = null;
      if (lesson === 0 && i === 1) p = { side: 'red', type: 'pawn', hidden: !lessonDone };
      if (lesson > 0 && i === (lessonDone ? 2 : 1)) p = { side: 'red', type: 'rook', hidden: false };
      if (lesson === 2 && !lessonDone && i === 2) p = { side: 'black', type: 'horse', hidden: false };
      if (p) b.innerHTML = pieceHTML(p);
      b.setAttribute('aria-label', p ? p.hidden ? '翻開這顆棋' : sideLabel(p.side) + E.name(p) : '空格');
      if (lesson > 0 && i === 2 && !lessonDone) b.classList.add('destination');
      if (lessonPicked && i === 1 && !lessonDone) b.classList.add('picked');
      b.onclick = () => {
        if (lessonDone) return;
        if (lesson === 0 && i === 1) lessonDone = true;
        else if (lesson > 0 && i === 1) lessonPicked = true;
        else if (lesson > 0 && i === 2 && lessonPicked) lessonDone = true;
        else { $('lessonFeedback').textContent = lesson > 0 && !lessonPicked ? '先點選紅色的俥喔。' : '試試有棋子或虛線框的位置。'; return; }
        if (lessonDone) tone(lesson === 0 ? 'flip' : lesson === 2 ? 'capture' : 'move');
        renderLesson();
        if (lessonDone) $('lessonNext').focus(); else $('lessonBoard').children[2].focus();
      };
      $('lessonBoard').append(b);
    }
  }
  $('lessonButton').onclick = () => { lesson = 0; lessonDone = false; lessonPicked = false; renderLesson(); openDialog('lessonDialog'); };
  $('lessonNext').onclick = () => { if (!lessonDone) return; if (lesson === 2) { $('lessonDialog').close(); return; } lesson++; lessonDone = false; lessonPicked = false; renderLesson(); $('lessonBoard').children[1].focus(); };
  mobile.addEventListener('change', () => { suggestion = null; });
  let layoutTimer;
  window.addEventListener('resize', () => {
    cancelSearch(); clearTimeout(aiTimer);
    render(); baseCoach();
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(scheduleAI, 180);
  });
  const wideLayout = window.matchMedia('(min-width: 64rem)');
  const tabletLayout = window.matchMedia('(any-pointer: coarse)');
  function positionControls() {
    const actions = $('hintButton').parentElement;
    const note = $('saveNote');
    if (wideLayout.matches && !tabletLayout.matches) {
      const sidebar = document.querySelector('.learning-area');
      sidebar.insertBefore(actions, document.querySelector('.quick-guide'));
      sidebar.insertBefore(note, document.querySelector('.quick-guide'));
    } else {
      const play = document.querySelector('.play-area');
      play.append(actions, note);
    }
  }
  tabletLayout.addEventListener('change', positionControls);
  wideLayout.addEventListener('change', positionControls);
  positionControls();
  render(); baseCoach(); save();
  if (restored) coach('歡迎回來，小棋手', state.result ? '上一局已完成，按「重新開始」就能再挑戰一次。' : '棋盤幫你留好了。' + (state.turn === 'human' ? '輪到你，繼續剛才的冒險吧！' : '接下來是小虎的回合。'));
  scheduleAI();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }
})();
