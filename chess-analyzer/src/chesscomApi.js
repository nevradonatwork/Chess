const BASE = 'https://api.chess.com/pub/player';

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Derive whose turn it is by counting half-moves in the PGN
function turnFromPgn(pgn) {
  if (!pgn) return 'white';
  const moveText = pgn
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\d+\.\.\.\s*/g, '')
    .replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, '')
    .trim();
  const halfMoves = moveText.split(/\s+/).filter(t => t && !/^\d+\.+$/.test(t)).length;
  return halfMoves % 2 === 0 ? 'white' : 'black';
}

function toUsername(val) {
  return typeof val === 'object' ? (val?.username ?? '?') : (val ?? '?');
}

export async function fetchOngoingGames(username) {
  const clean = username.trim().replace(/^https?:\/\/www\.chess\.com\/member\//i, '').replace(/\/$/, '');

  const [dailyRes, archiveRes] = await Promise.all([
    fetch(`${BASE}/${clean}/games`),
    fetch(`${BASE}/${clean}/games/${currentYearMonth()}`),
  ]);

  if (!dailyRes.ok && dailyRes.status !== 404) {
    throw new Error(`chess.com API error (${dailyRes.status}) – check username`);
  }

  const dailyData  = dailyRes.ok  ? await dailyRes.json()  : { games: [] };
  const archiveData = archiveRes.ok ? await archiveRes.json() : { games: [] };

  // Daily ongoing games — already normalized
  const dailyGames = (dailyData.games || []).map(g => ({
    ...g,
    white: toUsername(g.white),
    black: toUsername(g.black),
    time_class: 'daily',
  }));

  const dailyUrls = new Set(dailyGames.map(g => g.url));
  const nowSec = Date.now() / 1000;

  // Live games from this month's archive
  // Include: in-progress (result '*') OR finished within last 3 hours
  const liveGames = (archiveData.games || [])
    .filter(g => g.time_class && g.time_class !== 'daily')
    .filter(g => {
      const whiteResult = typeof g.white === 'object' ? g.white.result : null;
      const blackResult = typeof g.black === 'object' ? g.black.result : null;
      const inProgress = whiteResult === null || whiteResult === undefined ||
                         whiteResult === '*' || blackResult === '*';
      const recentlyFinished = g.end_time && (nowSec - g.end_time) < 3 * 3600;
      return inProgress || recentlyFinished;
    })
    .filter(g => !dailyUrls.has(g.url))
    .sort((a, b) => (b.end_time || nowSec) - (a.end_time || nowSec))
    .slice(0, 10)
    .map(g => ({
      ...g,
      white: toUsername(g.white),
      black: toUsername(g.black),
      turn: turnFromPgn(g.pgn),
    }));

  return { games: [...dailyGames, ...liveGames], username: clean };
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

  const moveText = pgn.replace(/\[[^\]]*\]/g, '').trim();
  const moves = moveText
    .replace(/\{[^}]*\}/g, '')
    .replace(/\d+\.\.\.\s*/g, '')
    .replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { white, black, moves, fen };
}
