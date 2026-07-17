import { Chess } from 'chess.js';

const BASE = 'https://api.chess.com/pub/player';

// chess.com's public API doesn't reliably send CORS headers for browser
// requests, so a direct fetch can fail outright (a network-level error,
// not a normal non-2xx response). Fall back to a CORS proxy when that
// happens so the app still works from a static page. If the proxy itself
// is unreachable, surface one clear app-level error rather than letting
// whatever the browser/proxy threw leak to the UI as-is.
async function fetchWithCorsFallback(url) {
  try {
    return await fetch(url);
  } catch {
    try {
      return await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
    } catch (e) {
      throw appError('Could not reach chess.com – check your internet connection and try again.');
    }
  }
}

// Response bodies from the CORS proxy aren't guaranteed to be valid JSON
// (e.g. the proxy's own error pages), so parsing is best-effort.
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return { games: [] };
  }
}

// Marks an error as one of ours (a deliberate, user-facing message) so the
// UI can tell it apart from an unexpected native/browser/library error and
// show it as-is instead of a generic fallback message.
function appError(message) {
  const err = new Error(message);
  err.isAppError = true;
  return err;
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Derive whose turn it is by loading the PGN into chess.js and reading the
// resulting turn. This handles "Custom Position" games correctly too: those
// start from a [FEN] tag (which can have Black to move first) rather than
// the standard start position, so simply counting half-moves and assuming
// White moved first (the old approach) gave the wrong answer for them.
function turnFromPgn(pgn) {
  if (!pgn) return 'white';
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return chess.turn() === 'w' ? 'white' : 'black';
  } catch {
    return 'white';
  }
}

function toUsername(val) {
  return typeof val === 'object' ? (val?.username ?? '?') : (val ?? '?');
}

export async function fetchOngoingGames(username) {
  const clean = username.trim().replace(/^https?:\/\/www\.chess\.com\/member\//i, '').replace(/\/$/, '');

  const [dailyRes, archiveRes] = await Promise.all([
    fetchWithCorsFallback(`${BASE}/${clean}/games`),
    fetchWithCorsFallback(`${BASE}/${clean}/games/${currentYearMonth()}`),
  ]);

  if (!dailyRes.ok && dailyRes.status !== 404) {
    throw appError(`chess.com API error (${dailyRes.status}) – check username`);
  }

  const dailyData  = dailyRes.ok  ? await safeJson(dailyRes)  : { games: [] };
  const archiveData = archiveRes.ok ? await safeJson(archiveRes) : { games: [] };

  // Daily ongoing games — already normalized
  const dailyGames = (dailyData.games || []).map(g => ({
    ...g,
    white: toUsername(g.white),
    black: toUsername(g.black),
    time_class: 'daily',
    turn: turnFromPgn(g.pgn),
  }));

  const dailyUrls = new Set(dailyGames.map(g => g.url));

  // Live games from this month's archive — only include games still in progress (no result yet)
  const liveGames = (archiveData.games || [])
    .filter(g => g.time_class && g.time_class !== 'daily')
    .filter(g => {
      const whiteResult = typeof g.white === 'object' ? g.white.result : null;
      const blackResult = typeof g.black === 'object' ? g.black.result : null;
      return !whiteResult || whiteResult === '*' || !blackResult || blackResult === '*';
    })
    .filter(g => !dailyUrls.has(g.url))
    .sort((a, b) => (b.end_time || 0) - (a.end_time || 0))
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
