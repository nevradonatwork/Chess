// Persistent, downloadable error log for this static, backend-less app.
// There's no server to write a real log file to, so entries are kept in
// localStorage (with full date/context/error detail) and can be exported
// as an actual .txt file on demand - e.g. so a user hitting a cryptic
// error can send us that file instead of just a screenshot.
const STORAGE_KEY = 'chess-analyzer-error-log';
const MAX_ENTRIES = 200;

function readLog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLog(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // localStorage unavailable or full - logging is best-effort, never fatal
  }
}

// context: short label for where this happened, e.g. "fetchOngoingGames".
// error: an Error/DOMException/ErrorEvent, or a plain string.
export function logError(context, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    context,
    name: error?.name ?? null,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  };
  console.error(`[${context}]`, error);
  writeLog([...readLog(), entry]);
  return entry;
}

export function getErrorLog() {
  return readLog();
}

export function clearErrorLog() {
  writeLog([]);
}

function formatEntry(e) {
  return [
    `[${e.timestamp}] ${e.context}`,
    `${e.name || 'Error'}: ${e.message}`,
    e.stack ? e.stack : '',
    e.userAgent ? `User agent: ${e.userAgent}` : '',
  ].filter(Boolean).join('\n');
}

export function downloadErrorLog() {
  const entries = readLog();
  const text = entries.length
    ? entries.map(formatEntry).join('\n\n---\n\n')
    : 'No errors logged.';
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chess-analyzer-error-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
