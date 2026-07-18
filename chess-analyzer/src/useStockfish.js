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
    let cancelled = false;
    const MAX_ATTEMPTS = 2; // 1 retry after a first transient failure

    // Worker init failures on mobile browsers (e.g. under memory pressure)
    // are often transient, so one retry happens silently before giving up
    // and asking the user to refresh manually.
    const failOrRetry = (attempt, context, error, failMessage) => {
      clearTimeout(timeout);
      if (sf) sf.terminate();
      if (cancelled) return;
      logError(attempt < MAX_ATTEMPTS - 1 ? `${context}-retrying` : context, error);
      if (attempt < MAX_ATTEMPTS - 1) {
        startEngine(attempt + 1);
      } else {
        setError(failMessage);
      }
    };

    function startEngine(attempt) {
      try {
        sf = new Worker(`${process.env.PUBLIC_URL}/stockfish.js`);

        let initDone = false;

        timeout = setTimeout(() => {
          if (!initDone) {
            failOrRetry(attempt, 'stockfish-init-timeout', new Error('No readyok within 20s'),
              'Engine timed out – try refreshing or use a desktop browser');
          }
        }, 20000);

        const initHandler = (e) => {
          const msg = typeof e === 'string' ? e : e.data;
          if (msg === 'uciok') {
            sf.postMessage('isready');
          }
          if (msg === 'readyok' && !initDone) {
            initDone = true;
            clearTimeout(timeout);
            sfRef.current = sf;
            setReady(true);
          }
        };

        sf.onmessage = initHandler;
        sf.onerror = (e) => {
          // Worker ErrorEvents often have an empty .message (e.g. for a
          // script-load failure), which used to log as the useless
          // "[object Event]" (String(e) on a plain Event). Pull out
          // whatever detail is actually available instead.
          const detail = e?.error instanceof Error
            ? e.error
            : new Error(e?.message || `Worker error${e?.filename ? ` at ${e.filename}:${e.lineno}:${e.colno}` : ' (no detail available)'}`);
          failOrRetry(attempt, 'stockfish-worker-error', detail, 'Engine failed to load – try refreshing');
        };
        sf.postMessage('uci');
      } catch (e) {
        clearTimeout(timeout);
        logError('stockfish-init', e);
        setError('Engine not supported on this browser');
      }
    }

    startEngine(0);

    return () => {
      cancelled = true;
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
