import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { logError } from './errorLog';

const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
// Depth 22 (desktop) / 15 (mobile) ply. A smaller transposition-table Hash
// and a movetime cap alongside the depth limit both reduce memory/time
// blowup risk on memory-constrained mobile WASM.
const DEFAULT_DEPTH = IS_MOBILE ? 15 : 22;
const HASH_MB = IS_MOBILE ? 8 : 32;
const MOVETIME_MS = IS_MOBILE ? 15000 : 30000;

export function useStockfish() {
  const sfRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  // The in-flight analyze() call's own settle function, if any, so a worker
  // crash/restart during analysis (not just during init) can unstick it
  // immediately instead of leaving the UI on "Analyzing…" forever.
  const pendingAnalysisRef = useRef(null);

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
      sfRef.current = null;
      if (pendingAnalysisRef.current) {
        const notifyCrash = pendingAnalysisRef.current;
        pendingAnalysisRef.current = null;
        notifyCrash();
      }
      if (cancelled) return;
      logError(attempt < MAX_ATTEMPTS - 1 ? `${context}-retrying` : context, error);
      if (attempt < MAX_ATTEMPTS - 1) {
        startEngine(attempt + 1);
      } else {
        setReady(false);
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
            sf.postMessage(`setoption name Hash value ${HASH_MB}`);
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

  const analyze = useCallback((fen, depth = DEFAULT_DEPTH) => {
    return new Promise((resolve) => {
      const sf = sfRef.current;
      if (!sf) { resolve({ bestMove: null, pvMoves: [], score: null, depthReached: 0, targetDepth: depth }); return; }

      let pvMoves = [];
      let score = null;
      let depthReached = 0;
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimeout);
        if (pendingAnalysisRef.current === notifyCrash) pendingAnalysisRef.current = null;
        resolve(result);
      };

      // Stockfish reports progress via "info depth N ... pv ..." lines as it
      // iteratively deepens, so the best line found at the deepest depth
      // reached so far is always sitting in pvMoves/score/depthReached. If
      // the search gets interrupted (worker crash/restart, or the safety
      // timeout below) before a "bestmove" ever arrives, that's still a
      // real - if shallower than requested - analysis, so it's used instead
      // of failing outright. A restarted engine has no UCI-level way to
      // resume the exact interrupted search (its transposition table and
      // search tree are gone), so this "best result so far" is the
      // practical equivalent rather than true resumption.
      const partialResult = () => ({
        bestMove: pvMoves[0] || null,
        pvMoves,
        score,
        partial: pvMoves.length > 0,
        depthReached,
        targetDepth: depth,
      });

      const notifyCrash = () => {
        const result = partialResult();
        if (result.partial) {
          logError('stockfish-partial-result-used',
            new Error(`Engine restarted mid-search at depth ${depthReached}/${depth}; using that partial result`));
        }
        finish(result);
      };

      // The engine is given a movetime cap alongside the depth limit (see
      // the "go" command below) as its own safety net, but if the worker
      // hangs or dies without ever emitting an error event, this backstop
      // still resolves the promise instead of leaving the UI stuck on
      // "Analyzing…" forever.
      const safetyTimeout = setTimeout(() => {
        logError('stockfish-analysis-timeout', new Error(`No bestmove within ${MOVETIME_MS + 5000}ms (depth ${depth}, reached ${depthReached})`));
        finish(partialResult());
      }, MOVETIME_MS + 5000);

      pendingAnalysisRef.current = notifyCrash;

      const handler = (e) => {
        const msg = typeof e === 'string' ? e : e.data;

        if (msg.startsWith('info') && msg.includes(' pv ')) {
          const depthMatch = msg.match(/(?:^|\s)depth (\d+)/);
          if (depthMatch) depthReached = parseInt(depthMatch[1], 10);

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
          finish({ bestMove, pvMoves, score, partial: false, depthReached, targetDepth: depth });
        }
      };

      sf.onmessage = handler;
      sf.postMessage('ucinewgame');
      sf.postMessage(`position fen ${fen}`);
      sf.postMessage(`go depth ${depth} movetime ${MOVETIME_MS}`);
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
