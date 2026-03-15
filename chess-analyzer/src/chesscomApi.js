const BASE = 'https://api.chess.com/pub/player';

export async function fetchOngoingGames(username) {
  const clean = username.trim().replace(/^https?:\/\/www\.chess\.com\/member\//i, '').replace(/\/$/, '');
  const res = await fetch(`${BASE}/${clean}/games`, {
    headers: { 'User-Agent': 'ChessAnalyzerApp/1.0' }
  });
  if (!res.ok) throw new Error(`chess.com API error (${res.status}) – check username`);
  const data = await res.json();
  return { games: data.games || [], username: clean };
}

export function parsePgn(pgn) {
  if (!pgn) return { white: '?', black: '?', moves: '', fen: '' };

  const tag = (name) => {
    const m = pgn.match(new RegExp(`\\[${name}\\s+"([^"]+)"\\]`));
    return m ? m[1] : '?';
  };

  const white = tag('White');
  const black = tag('Black');
  const fen = tag('FEN') !== '?' ? tag('FEN') : '';

  // Extract move text after headers
  const moveText = pgn.replace(/\[[^\]]*\]/g, '').trim();
  const moves = moveText.replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, '').trim();

  return { white, black, moves, fen };
}
