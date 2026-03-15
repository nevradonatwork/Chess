import React, { useState, useCallback } from 'react';
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

function GameCard({ game, username, onAnalyze }) {
  const { white, black, moves } = parsePgn(game.pgn);
  const isWhite = white.toLowerCase() === username.toLowerCase();
  const opponent = isWhite ? black : white;
  const myColor = isWhite ? '♙ White' : '♟ Black';
  const isMyTurn = (game.turn === 'white' && isWhite) || (game.turn === 'black' && !isWhite);

  return (
    <div className={`game-card ${isMyTurn ? 'my-turn' : ''}`}>
      <div className="game-header">
        <div className="game-title">
          <span className="player-name">{white}</span>
          <span className="vs">vs</span>
          <span className="player-name">{black}</span>
        </div>
        <div className="game-meta">
          <span className="my-color">{myColor}</span>
          <span className={`turn-badge ${isMyTurn ? 'your-turn' : 'waiting'}`}>
            {isMyTurn ? '🎯 Your turn!' : `⏳ ${opponent}'s turn`}
          </span>
        </div>
      </div>

      <div className="pgn-section">
        <div className="section-label">Moves so far</div>
        <div className="pgn-text">{moves || '(game just started)'}</div>
      </div>

      <button className="analyze-btn" onClick={() => onAnalyze(game, white, black)}>
        🔍 Analyze with Stockfish
      </button>
    </div>
  );
}

function AnalysisPanel({ result, onClose }) {
  if (!result) return null;
  const { white, black, moves, analysis, myTurn, myColor } = result;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{white} vs {black}</div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="analysis-status">
            <span className="color-badge">
              {myColor === 'white' ? '♙ You play White' : '♟ You play Black'}
            </span>
            {myTurn
              ? <span className="your-turn-badge">🎯 Your turn!</span>
              : <span className="waiting-badge">⏳ Waiting for opponent</span>
            }
          </div>

          <div className="section-label">Current game moves</div>
          <div className="pgn-text pgn-scrollable">{moves || '(no moves yet)'}</div>

          {analysis.error ? (
            <div className="error-box">{analysis.error}</div>
          ) : (
            <>
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
                  <div className="section-label">📋 Recommended line (next 10 moves)</div>
                  <MoveList moves={analysis.continuationSan} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [input, setInput] = useState('');
  const [username, setUsername] = useState('');
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);

  const { ready: sfReady, error: sfError, analyze } = useStockfish();

  const handleFetch = useCallback(async () => {
    const raw = input.trim();
    if (!raw) return;
    setFetchError('');
    setGames([]);
    setLoading(true);
    try {
      const { games: fetched, username: clean } = await fetchOngoingGames(raw);
      setUsername(clean);
      if (fetched.length === 0) {
        setFetchError('No ongoing games found for this account.');
      } else {
        setGames(fetched);
      }
    } catch (e) {
      setFetchError(e.message);
    } finally {
      setLoading(false);
    }
  }, [input]);

  const handleAnalyze = useCallback(async (game, white, black) => {
    setAnalyzing(true);
    setAnalysisResult(null);

    const { moves, fen: pgnFen } = parsePgn(game.pgn);
    const isWhite = white.toLowerCase() === username.toLowerCase();
    const myColor = isWhite ? 'white' : 'black';
    const myTurn = game.turn === myColor;

    let currentFen = pgnFen || fenFromMoves(moves);
    if (!currentFen) {
      currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    }

    let analysis = { bestMove: null, bestMoveSan: null, continuationSan: [], score: null, error: null };

    if (!sfReady) {
      analysis.error = 'Stockfish engine is still loading, please try again in a moment.';
    } else {
      try {
        const res = await analyze(currentFen, 20);
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

    setAnalysisResult({ white, black, moves, analysis, myTurn, myColor });
    setAnalyzing(false);
  }, [username, sfReady, analyze]);

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
          <label className="search-label">Enter your chess.com profile</label>
          <div className="search-row">
            <input
              className="search-input"
              type="text"
              placeholder="chess.com/member/YourName  or  YourName"
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

        {games.length > 0 && (
          <div className="games-section">
            <div className="games-count">
              {games.length} ongoing game{games.length > 1 ? 's' : ''} for <strong>{username}</strong>
            </div>
            {games.map((game, i) => (
              <GameCard
                key={game.url || i}
                game={game}
                username={username}
                onAnalyze={handleAnalyze}
              />
            ))}
          </div>
        )}

        {analyzing && (
          <div className="analyzing-overlay">
            <div className="analyzing-box">
              <div className="spinner">♟</div>
              <div>Stockfish is thinking…</div>
            </div>
          </div>
        )}
      </main>

      {analysisResult && (
        <AnalysisPanel result={analysisResult} onClose={() => setAnalysisResult(null)} />
      )}
    </div>
  );
}
