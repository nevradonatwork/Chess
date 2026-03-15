import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';

export function useStockfish() {
  const sfRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let sf;
    try {
      sf = new Worker(`${process.env.PUBLIC_URL}/stockfish.js`);

      let initDone = false;
      const initHandler = (e) => {
        const msg = typeof e === 'string' ? e : e.data;
        if (msg === 'uciok') {
          sf.postMessage('isready');
        }
        if (msg === 'readyok') {
          if (!initDone) {
            initDone = true;
            sfRef.current = sf;
            setReady(true);
          }
        }
      };

      sf.onmessage = initHandler;
      sf.onerror = () => setError('Stockfish failed to load');
      sf.postMessage('uci');
    } catch (e) {
      setError('Stockfish not available');
    }

    return () => { if (sf) sf.terminate(); };
  }, []);

  const analyze = useCallback((fen, depth = 18) => {
    return new Promise((resolve) => {
      const sf = sfRef.current;
      if (!sf) { resolve({ bestMove: null, pvMoves: [], score: null }); return; }

      let pvMoves = [];
      let score = null;

      const handler = (e) => {
        const msg = typeof e === 'string' ? e : e.data;

        if (msg.startsWith('info') && msg.includes(' pv ')) {
          const cpMatch = msg.match(/score cp (-?\d+)/);
          const mateMatch = msg.match(/score mate (-?\d+)/);
          if (cpMatch) score = parseInt(cpMatch[1], 10);
          if (mateMatch) score = `M${mateMatch[1]}`;

          const pvIdx = msg.indexOf(' pv ');
          if (pvIdx !== -1) {
            pvMoves = msg.slice(pvIdx + 4).trim().split(' ').slice(0, 11);
          }
        }

        if (msg.startsWith('bestmove')) {
          const bestMove = msg.split(' ')[1];
          sf.onmessage = null;
          resolve({ bestMove, pvMoves, score });
        }
      };

      sf.onmessage = handler;
      sf.postMessage('ucinewgame');
      sf.postMessage(`position fen ${fen}`);
      sf.postMessage(`go depth ${depth}`);
    });
  }, []);

  return { ready, error, analyze };
}

export function uciMovesToSan(startFen, uciMoves) {
  try {
    const chess = new Chess(startFen);
    const sanMoves = [];
    for (const uci of uciMoves) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length === 5 ? uci[4] : undefined;
      const result = chess.move({ from, to, promotion });
      if (!result) break;
      sanMoves.push(result.san);
    }
    return sanMoves;
  } catch {
    return uciMoves;
  }
}

export function fenFromMoves(moveText) {
  if (!moveText) return null;
  try {
    const chess = new Chess();
    const clean = moveText.replace(/\d+\.\s*/g, '').trim();
    const tokens = clean.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const result = chess.move(token);
      if (!result) break;
    }
    return chess.fen();
  } catch {
    return null;
  }
}
