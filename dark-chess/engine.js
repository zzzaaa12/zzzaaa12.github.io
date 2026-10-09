/* Dark chess rules. The opponent receives publicBoard() only. */
(function createEngine(root) {
  'use strict';
  const TYPES = [
    { key: 'king', rank: 7, count: 1, red: '帥', black: '將', value: 9 },
    { key: 'guard', rank: 6, count: 2, red: '仕', black: '士', value: 7 },
    { key: 'elephant', rank: 5, count: 2, red: '相', black: '象', value: 6 },
    { key: 'rook', rank: 4, count: 2, red: '俥', black: '車', value: 5 },
    { key: 'horse', rank: 3, count: 2, red: '傌', black: '馬', value: 4 },
    { key: 'cannon', rank: 2, count: 2, red: '炮', black: '包', value: 6 },
    { key: 'pawn', rank: 1, count: 5, red: '兵', black: '卒', value: 2 }
  ];
  const other = side => side === 'red' ? 'black' : 'red';
  const info = piece => TYPES.find(t => t.key === piece.type);
  const name = piece => info(piece)[piece.side];
  const adjacent = (a, b) => Math.abs(Math.floor(a / 8) - Math.floor(b / 8)) + Math.abs(a % 8 - b % 8) === 1;
  function screens(board, from, to) {
    if (from === to) return -1;
    const sameRow = Math.floor(from / 8) === Math.floor(to / 8);
    if (!sameRow && from % 8 !== to % 8) return -1;
    const step = sameRow ? Math.sign(to - from) : Math.sign(to - from) * 8;
    let count = 0;
    for (let i = from + step; i !== to; i += step) if (board[i]) count++;
    return count;
  }
  function canMove(board, from, to, side) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 31 || to < 0 || to > 31 || from === to) return false;
    const p = board[from], q = board[to];
    if (!p || p.hidden || p.side !== side || q?.hidden || q?.side === side) return false;
    if (!q) return adjacent(from, to);
    if (p.type === 'cannon') return screens(board, from, to) === 1;
    if (!adjacent(from, to)) return false;
    if (p.type === 'king' && q.type === 'pawn') return false;
    if (p.type === 'pawn' && q.type === 'king') return true;
    return info(p).rank >= info(q).rank;
  }
  function actions(board, side) {
    const result = [];
    for (let i = 0; i < 32; i++) {
      if (board[i]?.hidden) result.push({ kind: 'flip', to: i });
      else if (side && board[i]?.side === side) {
        const row = i / 8 | 0, col = i % 8;
        const targets = board[i].type === 'cannon' ? Array.from({ length: 8 }, (_, c) => row * 8 + c).concat(Array.from({ length: 4 }, (_, r) => r * 8 + col)) : [i - 8, i + 8, ...(col ? [i - 1] : []), ...(col < 7 ? [i + 1] : [])];
        for (const to of targets) if (canMove(board, i, to, side)) result.push({ kind: 'move', from: i, to });
      }
    }
    return result;
  }
  const publicBoard = board => board.map(p => !p ? null : p.hidden ? { hidden: true } : { type: p.type, side: p.side, hidden: false });
  function key(state) {
    return state.turn + ':' + state.board.map(p => !p ? '.' : p.hidden ? '?' : p.side[0] + p.type).join(',');
  }
  function create(random = Math.random) {
    const board = [];
    for (const side of ['red', 'black']) for (const type of TYPES) for (let i = 0; i < type.count; i++) board.push({ type: type.key, side, hidden: true });
    for (let i = board.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [board[i], board[j]] = [board[j], board[i]]; }
    const state = { board, humanSide: null, turn: 'human', ply: 0, captured: [], quiet: 0, positions: {}, result: null, last: null, lesson: '' };
    state.positions[key(state)] = 1;
    return state;
  }
  function apply(state, action) {
    if (state.result) throw new Error('這一局已結束。');
    const side = state.humanSide && (state.turn === 'human' ? state.humanSide : other(state.humanSide));
    if (!actions(state.board, side).some(a => a.kind === action.kind && a.to === action.to && a.from === action.from)) throw new Error('這一步不符合規則。');
    const next = JSON.parse(JSON.stringify(state));
    const target = next.board[action.to];
    next.last = { ...action, actor: state.turn, piece: action.kind === 'flip' ? { ...target, hidden: false } : { ...next.board[action.from] }, captured: action.kind === 'move' ? target : null };
    if (action.kind === 'flip') {
      target.hidden = false;
      if (!next.humanSide) next.humanSide = state.turn === 'human' ? target.side : other(target.side);
      next.quiet = 0;
    } else {
      if (target) {
        next.captured.push(target);
        next.quiet = 0;
        if (state.turn === 'human') next.lesson = next.last.piece.type === 'cannon' ? '你學會了用炮隔一顆棋吃子！' : next.last.piece.type === 'pawn' && target.type === 'king' ? '你發現了：小小的兵，也能吃掉將！' : '你成功用「' + name(next.last.piece) + '」吃掉了「' + name(target) + '」。';
      } else next.quiet++;
      next.board[action.to] = next.board[action.from];
      next.board[action.from] = null;
    }
    next.ply++;
    next.turn = state.turn === 'human' ? 'ai' : 'human';
    const nextSide = next.turn === 'human' ? next.humanSide : other(next.humanSide);
    if (!next.board.some(p => p && p.side === nextSide) || !actions(next.board, nextSide).length) next.result = { winner: state.turn, reason: '對方已沒有可以進行的行動。' };
    const k = key(next);
    next.positions[k] = (next.positions[k] || 0) + 1;
    if (!next.result && next.positions[k] >= 3) next.result = { winner: 'draw', reason: '相同局面出現三次，這局握手和棋！' };
    if (!next.result && next.quiet >= 80) next.result = { winner: 'draw', reason: '連續 80 步沒有翻棋或吃棋，這局握手和棋！' };
    if (!next.result && deadMaterial(next.board)) next.result = { winner: 'draw', reason: '棋盤只剩兩顆或三顆棋，而且已沒有任何一方能吃掉對方，這局自動判和。' };
    return next;
  }
  function moved(board, a) { const next = board.slice(); next[a.to] = next[a.from]; next[a.from] = null; return next; }
  function threatened(board, index, side) {
    return board.some((p, from) => p && !p.hidden && p.side !== side && canMove(board, from, index, p.side));
  }
  // Counts are derived exclusively from public pieces and publicly captured pieces.
  function hiddenPool(board, captured = []) {
    const pool = [];
    for (const side of ['red', 'black']) for (const t of TYPES) {
      const used = [...board.filter(p => p && !p.hidden), ...captured].filter(p => p.side === side && p.type === t.key).length;
      const count = Math.max(0, t.count - used);
      if (count) pool.push({ piece: { type: t.key, side, hidden: false }, count });
    }
    return pool;
  }
  const distance = (a, b) => Math.abs((a / 8 | 0) - (b / 8 | 0)) + Math.abs(a % 8 - b % 8);
  function beats(p, q) {
    if (p.type === 'cannon') return true;
    if (p.type === 'king' && q.type === 'pawn') return false;
    return p.type === 'pawn' && q.type === 'king' || info(p).rank >= info(q).rank;
  }
  function deadMaterial(board) {
    if (board.some(p => p?.hidden)) return false;
    const pieces = board.filter(Boolean);
    if (pieces.length < 2 || pieces.length > 3 || !pieces.some(p => p.side === 'red') || !pieces.some(p => p.side === 'black')) return false;
    for (const a of pieces) for (const b of pieces) {
      if (a.side === b.side) continue;
      if ((a.type === 'cannon' && pieces.length === 3) || beats(a, b)) return false;
    }
    return true;
  }
  const searchKey = (board, side) => side + ':' + board.map(p => !p ? '.' : p.hidden ? '?' : p.side[0] + p.type).join(',');
  function analyze(input, side, difficulty = 'standard', options = {}) {
    // Redact again at this boundary; even callers with a private board cannot leak it.
    const board = publicBoard(input), legal = actions(board, side);
    if (!legal.length) return { action: null, depth: 0, nodes: 0, score: 0 };
    const random = options.random || Math.random;
    if (!side) return { action: legal[Math.floor(random() * legal.length)], depth: 0, nodes: 0, score: 0, reason: '第一顆棋會決定你的隊伍。每一顆都可能是任何棋子，我也不知道裡面藏著誰！' };
    const limits = difficulty === 'practice' ? { depth: 2, nodes: 3000, ms: 160 } : difficulty === 'challenge' ? { depth: 6, nodes: 36000, ms: 850 } : { depth: 4, nodes: 14000, ms: 420 };
    const start = Date.now(), deadline = start + (options.timeMs ?? limits.ms);
    const maxNodes = options.maxNodes ?? limits.nodes;
    const pool = board.some(p => p?.hidden) ? hiddenPool(board, options.captured || []) : [], poolSize = pool.reduce((n, x) => n + x.count, 0);
    const history = options.repetitions || {}, path = new Map();
    const quiet = options.quiet || 0;
    const noHidden = !board.some(p => p?.hidden);
    const endgame = noHidden && board.filter(Boolean).length <= 10;
    const maxDepth = options.maxDepth ?? limits.depth + (endgame && difficulty !== 'practice' ? 2 : 0);
    let nodes = 0, depthDone = 0, stopped = false;
    const STOP = {};
    function tick() { nodes++; if (nodes > maxNodes || ((nodes & 31) === 0 && Date.now() >= deadline)) throw STOP; }
    function value(p, b) {
      if (p.type === 'king') {
        const pawnExists = b.some(q => q && !q.hidden && q.side !== p.side && q.type === 'pawn') || pool.some(x => x.piece.side !== p.side && x.piece.type === 'pawn');
        return pawnExists ? 680 : 1050;
      }
      if (p.type === 'pawn') return 180 + (b.some(q => q && !q.hidden && q.side !== p.side && q.type === 'king') ? 110 : 0);
      return { guard: 700, elephant: 560, rook: 470, horse: 380, cannon: 580 }[p.type];
    }
    function evaluate(b, turn) {
      let score = 0;
      const visible = b.map((p, i) => ({ p, i })).filter(x => x.p && !x.p.hidden);
      for (const { p, i } of visible) {
        let v = value(p, b);
        let prey = 20, hunter = 20;
        for (const { p: q, i: j } of visible) if (q.side !== p.side) {
          if (beats(p, q)) prey = Math.min(prey, distance(i, j));
          if (beats(q, p)) hunter = Math.min(hunter, distance(i, j));
        }
        if (noHidden && prey < 20) v += (12 - prey) * 7;
        if (noHidden && prey === 20 && hunter < 20) v += Math.min(hunter, 5) * 3;
        // A little central space helps manoeuvring without outweighing material.
        v += (3 - Math.abs(1.5 - (i / 8 | 0)) - Math.abs(3.5 - i % 8) * .4) * 2;
        score += p.side === turn ? v : -v;
      }
      return score;
    }
    // Static exchange evaluation follows recaptures on the same square.
    function exchange(b, action, turn, depth = 3) {
      const target = b[action.to];
      if (!target) return 0;
      const gain = value(target, b), after = moved(b, action);
      if (!depth) return gain;
      let reply = 0;
      for (let i = 0; i < 32; i++) if (canMove(after, i, action.to, other(turn))) reply = Math.max(reply, exchange(after, { kind: 'move', from: i, to: action.to }, other(turn), depth - 1));
      return gain - reply;
    }
    function flipEstimate(b, to, turn) {
      if (!poolSize) return evaluate(b, turn);
      let total = 0;
      for (const entry of pool) {
        const revealed = b.slice(); revealed[to] = entry.piece;
        let danger = 0;
        for (const a of actions(revealed, other(turn))) if (a.kind === 'move' && revealed[a.to]) danger = Math.max(danger, exchange(revealed, a, other(turn), 2));
        // Every possible identity is weighted by its remaining public count.
        total += entry.count * (evaluate(revealed, turn) - danger);
      }
      return total / poolSize + 8;
    }
    function ordered(b, turn, candidates) {
      return candidates.map(a => ({ a, priority: b[a.to] && !b[a.to].hidden ? value(b[a.to], b) * 10 - value(b[a.from], b) : 0 })).sort((x, y) => y.priority - x.priority).map(x => x.a);
    }
    function search(b, turn, depth, alpha, beta, ply, quietCount, extension = 2) {
      tick();
      const k = searchKey(b, turn), repeats = (history[k] || 0) + (path.get(k) || 0);
      const all = actions(b, turn), moves = all.filter(a => a.kind === 'move'), flips = all.filter(a => a.kind === 'flip');
      if (!flips.length) {
        if (!b.some(p => p?.side === turn) || !all.length) return -100000 + ply;
        if (!b.some(p => p?.side === other(turn))) return 100000 - ply;
      }
      if (repeats >= 2 || quietCount >= 80) return 0;
      path.set(k, (path.get(k) || 0) + 1);
      try {
        if (depth <= 0) {
          // Resolve forcing captures after the nominal horizon instead of valuing a bait at face value.
          let best = evaluate(b, turn);
          if (best >= beta) return best;
          alpha = Math.max(alpha, best);
          if (!extension) return best;
          for (const a of ordered(b, turn, moves.filter(a => b[a.to]))) {
            const score = -search(moved(b, a), other(turn), 0, -beta, -alpha, ply + 1, 0, extension - 1);
            best = Math.max(best, score); alpha = Math.max(alpha, score);
            if (alpha >= beta) break;
          }
          return best;
        }
        let best = -Infinity;
        for (const a of ordered(b, turn, moves)) {
          const score = -search(moved(b, a), other(turn), depth - 1, -beta, -alpha, ply + 1, b[a.to] ? 0 : quietCount + 1, extension);
          best = Math.max(best, score); alpha = Math.max(alpha, score);
          if (alpha >= beta) return best;
        }
        // Flip branches use a weighted one-ply chance estimate, never an invented known identity.
        for (const a of flips) {
          tick();
          const score = flipEstimate(b, a.to, turn);
          best = Math.max(best, score); alpha = Math.max(alpha, score);
          if (alpha >= beta) break;
        }
        return best;
      } finally {
        const n = path.get(k) - 1; if (n) path.set(k, n); else path.delete(k);
      }
    }
    const rootKey = searchKey(board, side);
    // Root is already included in the saved position history.
    if (!history[rootKey]) path.set(rootKey, 1);
    let ranked = legal.map(a => {
      if (a.kind === 'flip') return { action: a, score: flipEstimate(board, a.to, side), tie: random() };
      const after = moved(board, a);
      let danger = 0;
      for (const reply of actions(after, other(side))) if (reply.kind === 'move' && after[reply.to]) danger = Math.max(danger, exchange(after, reply, other(side)));
      return { action: a, score: evaluate(after, side) - danger, tie: random() };
    }).sort((a, b) => b.score - a.score || a.tie - b.tie);
    let best = ranked[0];
    for (let depth = 1; depth <= maxDepth; depth++) {
      const iteration = [];
      try {
        for (const item of ranked) {
          tick();
          const a = item.action;
          let score = a.kind === 'flip' ? item.score : -search(moved(board, a), other(side), depth - 1, -Infinity, Infinity, 1, board[a.to] ? 0 : quiet + 1);
          if (a.kind === 'move') {
            const visits = history[searchKey(moved(board, a), other(side))] || 0;
            if (Math.abs(score) < 90000 && visits < 2) score -= visits * 14;
          }
          iteration.push({ action: a, score, tie: item.tie });
        }
      } catch (e) { if (e !== STOP) throw e; stopped = true; break; }
      iteration.sort((a, b) => b.score - a.score || a.tie - b.tie);
      ranked = iteration; best = ranked[0]; depthDone = depth;
      if (Math.abs(best.score) > 90000) break;
    }
    const a = best.action;
    const reason = a.kind === 'flip' ? '根據剩餘棋子的數量，這個位置值得探索。翻開後仍可能是任何剩下的棋。' : board[a.to] ? '除了能吃到棋，也比較了對方接著吃回來的機會。' : threatened(board, a.from, side) && !threatened(moved(board, a), a.to, side) ? '先離開可能被吃的位置，保護這顆棋。' : endgame ? '調整距離與位置，嘗試接近能吃的棋，或保留退路。' : '先調整位置，也考慮對方接下來可能怎麼走。';
    return { action: a, score: best.score, depth: depthDone, nodes, elapsedMs: Date.now() - start, stopped, reason };
  }
  // Backwards-compatible action-only entry point for tests and other callers.
  function choose(board, side, difficulty = 'standard', random = Math.random, last = null, options = {}) {
    return analyze(board, side, difficulty, { ...options, random }).action;
  }
  function validState(s) {
    if (!s || !Array.isArray(s.board) || s.board.length !== 32 || !['human', 'ai'].includes(s.turn) || ![null, 'red', 'black'].includes(s.humanSide) || !Number.isInteger(s.ply) || s.ply < 0 || !Array.isArray(s.captured) || !s.positions || typeof s.positions !== 'object' || Array.isArray(s.positions) || !Number.isInteger(s.quiet)) return false;
    const validPiece = p => p && TYPES.some(t => t.key === p.type) && ['red', 'black'].includes(p.side) && typeof p.hidden === 'boolean';
    if (!s.board.every(p => p === null || validPiece(p)) || !s.captured.every(p => validPiece(p) && !p.hidden)) return false;
    for (const side of ['red', 'black']) for (const t of TYPES) if ([...s.board.filter(Boolean), ...s.captured].filter(p => p.side === side && p.type === t.key).length !== t.count) return false;
    if (!s.humanSide && (s.ply !== 0 || s.turn !== 'human' || s.board.some(p => !p?.hidden))) return false;
    if (s.humanSide && s.ply === 0) return false;
    if (s.result && (!['human', 'ai', 'draw'].includes(s.result.winner) || typeof s.result.reason !== 'string')) return false;
    if (s.last && (!['flip', 'move'].includes(s.last.kind) || !Number.isInteger(s.last.to) || s.last.to < 0 || s.last.to > 31 || !validPiece(s.last.piece) || !['human', 'ai'].includes(s.last.actor) || (s.last.kind === 'move' && (!Number.isInteger(s.last.from) || s.last.from < 0 || s.last.from > 31)) || (s.last.captured && !validPiece(s.last.captured)))) return false;
    return true;
  }
  const api = { TYPES, other, info, name, adjacent, screens, canMove, actions, publicBoard, key, create, apply, choose, analyze, hiddenPool, threatened, moved, validState };
  api.workerSource = '(' + createEngine.toString() + ')(globalThis);';
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DarkChess = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
