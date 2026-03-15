import React, { useState, useCallback, useRef } from 'react';
import './App.css';
import { fetchOngoingGames, parsePgn } from './chesscomApi';
import { useStockfish, uciMovesToSan, fenFromMoves } from './useStockfish';

function MoveList({ moves }) {
  if (!moves || moves.length === 0) return null;
  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ num: pairs.length + 1, w: moves[i], b: moves[i + 1] });
  }
  return (
    <div className="move-table">
      {pairs.map((p) => (
        <div key={p.num} className="move-row">
          <span className="move-num">{p.num}.</span>
          <span className="move-white">{p.w}</span>
          <span className="move-black">{p.b || ''}</span>
        </div>
      ))}
    </div>
  );
}

function GameCard({ result }) {
  const { white, black, moves, isMyTurn, myColor, analysis } = result;

  return (
    <div className={`game-card ${isMyTurn ? 'my-turn' : ''}`}>
      <div className="game-header">
        <div className="game-title">
          <span className="player-name">{white}</span>
          <span className="vs">vs</span>
          <span className="player-name">{black}</span>
        </div>
        <div className="game-meta">
          <span className="my-color">{myColor === 'white' ? '♙ White' : '♟ Black'}</span>
          <span className={`turn-badge ${isMyTurn ? 'your-turn' : 'waiting'}`}>
            {isMyTurn ? '🎯 Your turn!' : `⏳ ${myColor === 'white' ? black : white}'s turn`}
          </span>
        </div>
      </div>

      <div className="pgn-section">
        <div className="section-label">Moves so far</div>
        <div className="pgn-text pgn-scrollable">{moves || '(game just started)'}</div>
      </div>

      {!analysis && (
        <div className="inline-analyzing">
          <span className="spinner-sm">♟</span> Analyzing…
        </div>
      )}

      {analysis && analysis.error && (
        <div className="error-box">{analysis.error}</div>
      )}

      {analysis && !analysis.error && (
        <div className="inline-analysis">
          <div className="best-move-box">
            <div className="best-move-label">⭐ Best next move</div>
            <div className="best-move-value">{analysis.bestMoveSan || analysis.bestMove || '—'}</div>
            {analysis.score !== null && (
              <div className="score-label">
                Eval:{' '}
                {typeof analysis.score === 'number'
                  ? `${analysis.score > 0 ? '+' : ''}${(analysis.score / 100).toFixed(2)}`
                  : analysis.score}
              </div>
            )}
          </div>

          {analysis.continuationSan && analysis.continuationSan.length > 0 && (
            <div className="continuation-section">
              <div className="section-label">📋 Recommended line</div>
              <MoveList moves={analysis.continuationSan} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [gameResults, setGameResults] = useState([]);
  const [username, setUsername] = useState('');

  const { ready: sfReady, error: sfError, analyze } = useStockfish();
  const sfReadyRef = useRef(sfReady);
  sfReadyRef.current = sfReady;

  const runAnalysis = useCallback(async (entries, analyze) => {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const { moves, fen: pgnFen } = parsePgn(entry.game.pgn);
      let currentFen = pgnFen || fenFromMoves(moves);
      if (!currentFen) {
        currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      }

      let analysis = { bestMove: null, bestMoveSan: null, continuationSan: [], score: null, error: null };

      if (!sfReadyRef.current) {
        analysis.error = 'Engine not ready – try refreshing.';
      } else {
        try {
          const res = await analyze(currentFen);
          analysis.bestMove = res.bestMove;
          analysis.score = res.score;

          if (res.pvMoves && res.pvMoves.length > 0) {
            const { Chess } = await import('chess.js');
            const chess = new Chess(currentFen);
            const from = res.bestMove?.slice(0, 2);
            const to = res.bestMove?.slice(2, 4);
            const promo = res.bestMove?.length === 5 ? res.bestMove[4] : undefined;
            if (from && to) {
              const m = chess.move({ from, to, promotion: promo });
              if (m) analysis.bestMoveSan = m.san;
            }
            analysis.continuationSan = uciMovesToSan(currentFen, res.pvMoves);
          }
        } catch (e) {
          analysis.error = `Analysis failed: ${e.message}`;
        }
      }

      setGameResults(prev => prev.map((r, idx) => idx === i ? { ...r, analysis } : r));
    }
  }, []);

  const handleFetch = useCallback(async () => {
    const raw = input.trim();
    if (!raw) return;
    setFetchError('');
    setGameResults([]);
    setLoading(true);
    try {
      const { games: fetched, username: clean } = await fetchOngoingGames(raw);
      setUsername(clean);
      if (fetched.length === 0) {
        setFetchError('No ongoing games found for this account.');
        return;
      }

      const entries = fetched.map(game => {
        const { white, black } = parsePgn(game.pgn);
        const isWhite = white.toLowerCase() === clean.toLowerCase();
        const myColor = isWhite ? 'white' : 'black';
        const isMyTurn = game.turn === myColor;
        return { game, white, black, moves: parsePgn(game.pgn).moves, isWhite, myColor, isMyTurn, analysis: null };
      });

      setGameResults(entries);
      runAnalysis(entries, analyze);
    } catch (e) {
      setFetchError(e.message);
    } finally {
      setLoading(false);
    }
  }, [input, analyze, runAnalysis]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <span className="header-icon">♟</span>
          <h1 className="app-title">Chess Analyzer</h1>
        </div>
        <div className={`sf-status ${sfReady ? 'ready' : sfError ? 'error' : 'loading'}`}>
          {sfReady ? '● Engine ready' : sfError ? '● Engine error' : '● Loading…'}
        </div>
      </header>

      <main className="app-main">
        <div className="search-section">
          <label className="search-label">Enter your chess.com username</label>
          <div className="search-row">
            <input
              className="search-input"
              type="text"
              placeholder="e.g. nevradonat"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
            />
            <button
              className="search-btn"
              onClick={handleFetch}
              disabled={loading || !input.trim()}
            >
              {loading ? '⏳' : '🔎'}
            </button>
          </div>
          {fetchError && <div className="fetch-error">{fetchError}</div>}
        </div>

        {gameResults.length > 0 && (
          <div className="games-section">
            <div className="games-count">
              {gameResults.length} ongoing game{gameResults.length > 1 ? 's' : ''} for <strong>{username}</strong>
            </div>
            {gameResults.map((result, i) => (
              <GameCard key={result.game.url || i} result={result} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
