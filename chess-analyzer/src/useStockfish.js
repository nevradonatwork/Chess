import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { logError } from './errorLog';

export function useStockfish() {
  const sfRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let sf;
    let timeout;
    try {
      sf = new Worker(`${process.env.PUBLIC_URL}/stockfish.js`);

      let initDone = false;

      timeout = setTimeout(() => {
        if (!initDone) {
          logError('stockfish-init-timeout', new Error('No readyok within 20s'));
          setError('Engine timed out – try refreshing or use a desktop browser');
          if (sf) sf.terminate();
        }
      }, 20000);

      const initHandler = (e) => {
        const msg = typeof e === 'string' ? e : e.data;
        if (msg === 'uciok') {
          sf.postMessage('isready');
        }
        if (msg === 'readyok') {
          if (!initDone) {
            initDone = true;
            clearTimeout(timeout);
            sfRef.current = sf;
            setReady(true);
          }
        }
      };

      sf.onmessage = initHandler;
      sf.onerror = (e) => {
        clearTimeout(timeout);
        logError('stockfish-worker-error', e?.message ? e : new Error(String(e)));
        setError('Engine failed to load – try refreshing');
      };
      sf.postMessage('uci');
    } catch (e) {
      clearTimeout(timeout);
      logError('stockfish-init', e);
      setError('Engine not supported on this browser');
    }

    return () => {
      clearTimeout(timeout);
      if (sf) sf.terminate();
    };
  }, []);

  const analyze = useCallback((fen, depth = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 12 : 18) => {
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

// Derive the current position straight from the raw PGN via chess.js's own
// PGN loader, rather than hand-parsing the move text. This matters for
// chess.com "Custom Position" games: they carry a [FEN]/[SetUp] tag with a
// non-standard start position (sometimes with Black to move first) and
// movetext like "1... d5 2. e5", and chess.js's loadPgn already knows how to
// replay that correctly onto the custom start — a manual regex-based
// tokenizer kept mis-handling the "N... "/"N. ... " ellipsis markers and,
// worse, was never even applying the played moves on top of the custom FEN.
export function fenFromPgn(pgn) {
  if (!pgn) return { fen: null, complete: true };
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return { fen: chess.fen(), complete: true };
  } catch {
    return { fen: null, complete: false };
  }
}
