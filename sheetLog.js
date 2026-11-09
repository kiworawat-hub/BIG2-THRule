// Sends the result of every finished match to a Google Sheet (through a small
// Apps Script web app -- see sheets/Code.gs). Entirely optional: with no
// SHEET_WEBHOOK_URL set it does nothing, and a failure here never touches the
// game (it is fire-and-forget, with a few retries).

const crypto = require("crypto");

const TZ = "Asia/Bangkok";

function thaiParts(date) {
  const f = (opts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", ...opts }).format(date);
  return {
    date: f({ year: "numeric", month: "2-digit", day: "2-digit" }),               // 2026-11-09
    time: f({ hour: "2-digit", minute: "2-digit", second: "2-digit" }),            // 22:18:05
  };
}

// One row per real player. Bots have no name and are not listed.
function buildPayload(room, endedAt = new Date()) {
  const names = room.finalPlayers || room.players;
  const scores = room.finalCumulative || [0, 0, 0, 0];
  const order = [0, 1, 2, 3].sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
  const rankOf = (s) => order.indexOf(s) + 1;
  const { date, time } = thaiParts(endedAt);
  return {
    matchId: crypto.randomBytes(6).toString("hex"),
    endedAt: endedAt.toISOString(),
    date, time,
    rounds: room.round,
    rows: [0, 1, 2, 3]
      .filter((s) => names[s])
      .map((s) => ({ name: names[s], score: scores[s] || 0, rank: rankOf(s) })),
  };
}

async function postOnce(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script takes the raw body
    body: JSON.stringify(body),
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

// Never throws and never blocks the caller.
function logMatch(room, opts = {}) {
  const url = process.env.SHEET_WEBHOOK_URL;
  if (!url) return null;
  if (!room.allHumanStart) return null; // started with bots in it: not a leaderboard match
  const payload = buildPayload(room);
  if (payload.rows.length === 0) return null;
  if (process.env.SHEET_SECRET) payload.secret = process.env.SHEET_SECRET;
  const delays = opts.retryDelaysMs || [2000, 10000, 60000];
  const done = (async () => {
    for (let i = 0; i <= delays.length; i++) {
      try { await postOnce(url, payload); return true; }
      catch (e) {
        if (i === delays.length) { console.error("[sheet] could not log match:", e.message); return false; }
        await new Promise((r) => setTimeout(r, delays[i]));
      }
    }
  })().catch(() => false);
  return done; // tests await it; the game ignores it
}

module.exports = { buildPayload, logMatch };
