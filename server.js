// ============================================================
// BIG2 real-time server — Express serves the static client,
// Socket.io handles all real-time game events. This file is the
// single source of truth for game state; clients never decide
// outcomes themselves, they only send intended actions.
// ============================================================
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const {
  cardKey, dealFour, findStartPlayer, handContainsAll, classifyCombo, comboBeats,
  computePayouts, resolveNextTurn, getForcedHighCard,
  autoTimeoutMove, cannotBeatByCount, legOf,
  drawSeatCards, seatDrawOrder, fillRemainingSeats,
  find5CardCombos,
} = require("./gameLogic");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 30; // responding to an active trick
const LEAD_TURN_SECONDS = 45; // leading a fresh trick — more to think through
const FIRST_PLAY_SECONDS = 60; // opening a fresh round — you have 13 cards to sort first
const MAX_PAUSE_MS = 5 * 60 * 1000; // a pause expires by itself so nobody can freeze the game
const ROUND_RESULT_DELAY_MS = 4000; // how long the round-result overlay stays up before auto-continuing
const SEAT_DRAW_STEP_MS = 300; // how fast each seat-draw pick auto-resolves
const SEAT_DRAW_MIN_DISPLAY_MS = 2000; // seat-draw screen always shows for at least this long
// How long a room with nobody connected is kept before it is thrown away.
// Seats are reserved by name, so this doubles as the reconnect window: a
// player whose phone died has this long to rejoin and get their hand back.
const EMPTY_ROOM_TTL_MS = Number(process.env.BIG2_ROOM_TTL_MS) || 30 * 60 * 1000;
const MAX_LOG_LINES = 200; // the play-by-play log is only kept for debugging
// What one "minute" of a timed match is worth. Only the tests turn it down —
// waiting out a real minute per assertion would make the suite unusable.
const MATCH_TIME_UNIT_MS = Number(process.env.BIG2_MATCH_TIME_UNIT_MS) || 60 * 1000;
const LAST_ROUNDS_ON_TIME = 4; // "เวลาหมดแล้ว เล่นอีก 4 ตา" — same as the manual button
// After a round, everyone who was multiplied is asked whether to redraw the
// seats. No answer inside this window counts as "no", so a player who has
// wandered off cannot hold the table up.
const SEAT_PROMPT_MS = Number(process.env.BIG2_SEAT_PROMPT_MS) || 10 * 1000;
// A seat that holds fewer cards than the play on the table cannot answer it,
// so the server passes for it -- after this beat, so the player sees it happen
// instead of the turn skipping past them unannounced.
const AUTO_PASS_DELAY_MS = Number(process.env.BIG2_AUTO_PASS_MS) || 800;

// rooms: code -> room object (kept in memory; resets if the server restarts)
const rooms = new Map();

// Per-socket rate limits. Room codes are 4 characters from a 32-letter
// alphabet -- about a million combinations -- so without a cap on joinRoom an
// attacker could simply enumerate them and walk into strangers' games. The
// other limits just stop a modified client flooding the room.
const RATE_LIMITS = {
  joinRoom: { max: 10, windowMs: 60000 },
  createRoom: { max: 10, windowMs: 60000 },
  chatMessage: { max: 20, windowMs: 10000 },
  default: { max: 60, windowMs: 10000 },
};

function withinRateLimit(socket, event) {
  const limit = RATE_LIMITS[event] || RATE_LIMITS.default;
  const now = Date.now();
  if (!socket.data.rate) socket.data.rate = {};
  let bucket = socket.data.rate[event];
  if (!bucket || now > bucket.resetAt) {
    bucket = socket.data.rate[event] = { count: 0, resetAt: now + limit.windowMs };
  }
  bucket.count += 1;
  return bucket.count <= limit.max;
}

// Two typings of the same name. Phone keyboards capitalise the first letter
// by themselves, so "pok" coming back as "Pok" has to still be the same player.
function sameName(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function makeSeatToken() {
  return require("crypto").randomBytes(16).toString("hex");
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function newRoomState(hostName, hostSocketId) {
  return {
    phase: "waiting", // waiting | seatdraw | playing | finished | gameover
    players: [hostName, null, null, null], // display names, null = open seat (bot fills it)
    socketIds: [hostSocketId, null, null, null],
    // Secret per seat, handed to that player and kept in their browser. Seats
    // are claimed by name so a dropped player can come back, but without this
    // anyone who knows the room code could type your name and take your hand.
    seatTokens: [null, null, null, null],
    // The host is whoever made the room, and is tracked by seat token, which
    // follows a player through every reseat. It used to be "the lowest-numbered
    // occupied seat", which handed the match controls to a different player
    // each time the seats were redrawn -- the buttons kept appearing and
    // vanishing for the person who had them a round ago.
    hostToken: null,
    // Socket ids of people watching without a seat. Deliberately NOT part of
    // socketIds: an observer must not keep an abandoned room alive, and every
    // action handler already refuses seat -1, so watching stays read-only.
    observers: new Set(),
    // What the lobby hands out so a stranger can watch. It is not the room
    // code: the code would also let them take a seat, read the chat and join
    // the voice call, and this one only works with observeRoom.
    watchId: makeSeatToken(),
    hands: [[], [], [], []],
    turn: null,
    turnStartedAt: null,
    lastPlay: null,
    lastPlayerSeat: null,
    passedThisTrick: [],
    trickPile: [],
    finished: [],
    everPlayed: false,
    round: 0,
    roundHistory: [],
    payout: null,
    log: [],
    chat: [],
    seatDraw: null,
    lastMultiplierVictims: [],
    // While the multiplied players are being asked about a reseat:
    //   { seat, leg, until, queue: [seats still to ask] }
    seatPrompt: null,
    matchRoundsRemaining: null, // null = play forever; a number = "last N rounds" mode
    // How the match ends, chosen in the waiting room:
    //   null                        play until someone calls "last 4 rounds"
    //   { type:"rounds", value:N }  stop after N rounds
    //   { type:"points", value:N }  stop once anyone is N or more chips up or down
    //   { type:"time",   value:N }  after N minutes, play the last 4 rounds out
    matchLimit: null,
    matchDeadline: null, // when a timed match starts its final countdown
    finalCumulative: null,
    botTimer: null,
    turnTimer: null,
    roundEndTimer: null,
    seatDrawTimer: null,
    cleanupTimer: null,
    paused: null, // { by, at, until } while the game is on a break
    pauseTimer: null,
  };
}

// How long the player on turn gets. The opening play of a round is the one
// moment you are holding 13 unsorted cards, so it is deliberately longer.
function turnDurationSeconds(room) {
  if (!room.everPlayed) return FIRST_PLAY_SECONDS;
  return room.lastPlayerSeat === null ? LEAD_TURN_SECONDS : TURN_SECONDS;
}

// Any player may call a break and any player may end it — same as a real
// table. The cap matters: the turn clock is what stops one absent player from
// freezing everyone, and a pause switches that protection off.
function pauseRoom(room, seat) {
  if (room.phase !== "playing" || room.paused) return false;
  clearTimers(room);
  const now = Date.now();
  room.paused = { by: room.players[seat] || `บอท ${seat + 1}`, at: now, until: now + MAX_PAUSE_MS };
  room.pauseTimer = setTimeout(() => {
    resumeRoom(room);
    broadcastState(room.code);
  }, MAX_PAUSE_MS);
  return true;
}

function resumeRoom(room) {
  if (!room.paused) return false;
  if (room.pauseTimer) { clearTimeout(room.pauseTimer); room.pauseTimer = null; }
  // a break is not playing time: a timed match owes back whatever it cost
  if (room.matchDeadline) room.matchDeadline += Date.now() - room.paused.at;
  room.paused = null;
  room.turnStartedAt = Date.now(); // the interrupted player gets a full turn back
  scheduleTurn(room);
  return true;
}

function roomIsEmpty(room) {
  return room.socketIds.every(id => id === null);
}

// The lobby sign board: what is being played right now, for anyone who opens
// the site. Deliberately WITHOUT the room code -- the code is the only thing
// guarding a room, so publishing it would let strangers take an open seat,
// read the chat and join the voice call. Names, how far along, and a watchId
// that buys nothing but a seat in the audience.
function activeRoomSummaries() {
  const out = [];
  for (const room of rooms.values()) {
    if (roomIsEmpty(room)) continue; // abandoned rooms linger for EMPTY_ROOM_TTL_MS
    out.push({ players: room.players, phase: room.phase, round: room.round,
               watchId: room.watchId, observers: room.observers.size });
  }
  return out;
}

// Rooms live in memory forever otherwise — and an abandoned one keeps its bots
// playing, growing roundHistory the whole time. Once the last player is gone,
// start the countdown; anyone rejoining cancels it.
function scheduleRoomCleanup(room) {
  cancelRoomCleanup(room);
  if (!roomIsEmpty(room)) return;
  room.cleanupTimer = setTimeout(() => {
    if (!roomIsEmpty(room)) return; // someone came back
    clearTimers(room);
    if (room.pauseTimer) { clearTimeout(room.pauseTimer); room.pauseTimer = null; }
    if (room.voiceSockets) room.voiceSockets.clear();
    rooms.delete(room.code);
  }, EMPTY_ROOM_TTL_MS);
}

function cancelRoomCleanup(room) {
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
}

function pushLog(room, line) {
  room.log.push(line);
  if (room.log.length > MAX_LOG_LINES) room.log = room.log.slice(-MAX_LOG_LINES);
}

function seatOf(room, socketId) {
  return room.socketIds.findIndex(id => id === socketId);
}

// The room this socket is in, seated or watching. getHistory uses it so an
// observer can ask too -- they are never told the room code.
function roomOf(socketId) {
  for (const room of rooms.values()) {
    if (seatOf(room, socketId) !== -1 || room.observers.has(socketId)) return room;
  }
  return null;
}

// Drops a watcher from whichever room they were watching; returns that room's
// code so the caller can refresh the viewer count the players see.
function stopObserving(socketId) {
  for (const room of rooms.values()) {
    if (room.observers.delete(socketId)) return room.code;
  }
  return null;
}

// Match-level controls (start, restart, "last N rounds") belong to the host.
// The state each player receives carries isHost, worked out here, so the client
// shows the buttons to exactly the people the server will obey. If the host
// happens to be disconnected, any seated player may act instead -- otherwise a
// host who closed their tab would freeze the room until it expires.
function hostSeatOf(room) {
  if (room.hostToken) {
    const bySeatToken = room.seatTokens.findIndex(t => t && t === room.hostToken);
    if (bySeatToken !== -1) return bySeatToken;
  }
  // no host on record (or they have left): the lowest occupied seat
  return room.players.findIndex(p => p !== null);
}

function isHost(room, seat) {
  if (seat === -1) return false;
  const hostSeat = hostSeatOf(room);
  if (hostSeat === -1) return false;
  return seat === hostSeat || room.socketIds[hostSeat] === null;
}

// Sends each connected player only THEIR OWN hand (never opponents' cards).
function broadcastState(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (let s = 0; s < 4; s++) {
    if (!room.socketIds[s]) continue;
    const sock = io.sockets.sockets.get(room.socketIds[s]);
    if (!sock) continue;
    sock.emit("state", sanitizeForSeat(room, s));
  }
  if (!room.observers.size) return;
  // Seat -1 is the public view: no hand of its own, and it reveals the four
  // hands at the end of a round exactly when the players themselves see them.
  const publicView = sanitizeForSeat(room, -1);
  for (const id of room.observers) io.sockets.sockets.get(id)?.emit("state", publicView);
}

function cumulativeScores(room) {
  const totalsByName = {};
  const botTotals = [0, 0, 0, 0]; // positional fallback — bots have no persistent identity across reseats
  room.roundHistory.forEach(r => {
    const namesAtRound = r.players || room.players;
    r.net.forEach((v, i) => {
      const name = namesAtRound[i];
      if (name) totalsByName[name] = (totalsByName[name] || 0) + v;
      else botTotals[i] += v;
    });
  });
  return [0, 1, 2, 3].map(s => {
    const name = room.players[s];
    return name ? (totalsByName[name] || 0) : botTotals[s];
  });
}

function sanitizeForSeat(room, seat) {
  return {
    // an observer never learns the code -- it is the one thing that would let
    // them stop watching and sit down at somebody else's table
    code: seat === -1 ? null : room.code,
    phase: room.phase,
    players: room.players,
    mySeat: seat, // -1 = watching from outside the table
    isHost: isHost(room, seat),
    myHand: room.hands[seat] || [],
    observers: room.observers.size,
    handCounts: room.hands.map(h => h.length),
    // reveal everyone's actual hands only once the round is over — never during active play
    allHands: (room.phase === "finished" || room.phase === "gameover") ? room.hands : null,
    turn: room.turn,
    turnStartedAt: room.turnStartedAt,
    turnSeconds: turnDurationSeconds(room),
    paused: room.paused,
    lastPlayerSeat: room.lastPlayerSeat,
    passedThisTrick: room.passedThisTrick,
    trickPile: room.trickPile,
    finished: room.finished,
    round: room.round,
    // roundHistory is deliberately NOT here: it is the one part of the state
    // that only grows, and this object goes out on every single play. It is
    // fetched with getHistory when somebody opens the history screen.
    cumulative: cumulativeScores(room),
    payout: room.payout,
    everPlayed: room.everPlayed,
    seatDraw: room.seatDraw,
    // who is being asked about a reseat right now; the queue behind them stays private
    seatPrompt: room.seatPrompt
      ? { seat: room.seatPrompt.seat, leg: room.seatPrompt.leg, until: room.seatPrompt.until }
      : null,
    // the seat the server is about to pass for because it cannot answer
    autoPassSeat: pendingAutoPassSeat(room),
    matchRoundsRemaining: room.matchRoundsRemaining,
    matchLimit: room.matchLimit,
    matchDeadline: room.matchDeadline,
    finalCumulative: room.finalCumulative,
  };
}

function clearTimers(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  if (room.roundEndTimer) { clearTimeout(room.roundEndTimer); room.roundEndTimer = null; }
  if (room.seatDrawTimer) { clearTimeout(room.seatDrawTimer); room.seatDrawTimer = null; }
}

function startRound(room, forcedLeaderSeat) {
  const hands = dealFour();
  const startSeat = (forcedLeaderSeat !== null && forcedLeaderSeat !== undefined) ? forcedLeaderSeat : findStartPlayer(hands);
  room.phase = "playing";
  room.seatDraw = null;
  room.hands = hands;
  // a copy, taken before anybody plays: room.hands only ever shrinks from here
  room.startingHands = hands.map(h => h.map(c => ({ rank: c.rank, suit: c.suit })));
  room.seatPrompt = null;
  room.turn = startSeat;
  room.turnStartedAt = Date.now();
  room.lastPlay = null;
  room.lastPlayerSeat = null;
  room.passedThisTrick = [];
  room.trickPile = [];
  room.finished = [];
  room.everPlayed = false;
  room.payout = null;
  room.round += 1;
  scheduleTurn(room);
}

// Kicks off the fast, fully-automatic seat draw. pendingRound is the round
// number that will actually be dealt once all 4 seats are resolved.
function beginSeatDraw(room, pendingRound, winnerOldSeat) {
  clearTimers(room);
  const cards = drawSeatCards();
  const order = seatDrawOrder(cards);
  room.phase = "seatdraw";
  room.seatDraw = {
    cards, order, picks: {}, pendingRound,
    playersAtDraw: [...room.players],
    socketIdsAtDraw: [...room.socketIds],
    winnerOldSeat: winnerOldSeat ?? null,
    startedAt: Date.now(),
  };
  scheduleSeatDrawStep(room);
}

function scheduleSeatDrawStep(room) {
  const sd = room.seatDraw;
  if (!sd) return;
  const step = Object.keys(sd.picks).length;
  if (step >= 2) return; // steps 2/3 resolve synchronously inside applySeatPick
  const pickerOldSeat = sd.order[step];
  room.seatDrawTimer = setTimeout(() => {
    let choice;
    if (step === 0) {
      choice = Math.floor(Math.random() * 4);
    } else {
      const seat1Pick = sd.picks[sd.order[0]];
      const options = [(seat1Pick + 1) % 4, (seat1Pick + 3) % 4];
      choice = options[Math.floor(Math.random() * 2)];
    }
    applySeatPick(room, pickerOldSeat, choice);
  }, SEAT_DRAW_STEP_MS);
}

function applySeatPick(room, pickerOldSeat, newSeat) {
  const sd = room.seatDraw;
  if (!sd) return;
  if (Object.values(sd.picks).includes(newSeat)) return; // shouldn't happen, safety
  let picks = { ...sd.picks, [pickerOldSeat]: newSeat };

  if (Object.keys(picks).length === 2) {
    const [seat1, seat2] = sd.order;
    const [remA, remB] = fillRemainingSeats(picks[seat1], picks[seat2]);
    picks = { ...picks, [sd.order[2]]: remA, [sd.order[3]]: remB };
  }

  sd.picks = picks;

  if (Object.keys(picks).length >= 4) {
    // Remap the CURRENT occupants, not the snapshot taken when the draw
    // started: someone who joined during the draw sits in room.players but
    // not in playersAtDraw, and reading the snapshot here would erase them
    // (their client then hangs on the seat-draw screen forever).
    const newPlayers = [null, null, null, null];
    const newSocketIds = [null, null, null, null];
    const newSeatTokens = [null, null, null, null];
    [0, 1, 2, 3].forEach(oldSeat => {
      newPlayers[picks[oldSeat]] = room.players[oldSeat];
      newSocketIds[picks[oldSeat]] = room.socketIds[oldSeat];
      // the token has to follow its owner, or reconnecting after a reseat
      // would look like an impostor
      newSeatTokens[picks[oldSeat]] = room.seatTokens[oldSeat];
    });
    room.players = newPlayers;
    room.socketIds = newSocketIds;
    room.seatTokens = newSeatTokens;
    const forcedLeader = (sd.winnerOldSeat !== null && sd.winnerOldSeat !== undefined) ? picks[sd.winnerOldSeat] : null;
    broadcastState(room.code); // show the completed layout briefly
    const elapsed = Date.now() - sd.startedAt;
    const remainingDelay = Math.max(0, SEAT_DRAW_MIN_DISPLAY_MS - elapsed);
    room.seatDrawTimer = setTimeout(() => {
      startRound(room, forcedLeader);
      broadcastState(room.code);
    }, remainingDelay);
  } else {
    broadcastState(room.code);
    scheduleSeatDrawStep(room);
  }
}

// Called once a round's result overlay has been showing for a bit — either
// starts the next round (possibly via a reseat), or ends the match if the
// "last N rounds" countdown has run out.
// Has the match-end condition chosen in the waiting room been met?
function matchLimitReached(room) {
  if (!room.matchLimit) return false;
  if (room.matchLimit.type === "points") {
    return cumulativeScores(room).some(v => Math.abs(v) >= room.matchLimit.value);
  }
  return false; // "rounds" runs through matchRoundsRemaining
}

function advanceAfterRound(room) {
  if (room.phase !== "finished") return;
  // A timed match does not stop mid-flow when the clock runs out: the round
  // that was being played finishes, and then everyone gets the same last few
  // rounds they would have got from the "4 ตาสุดท้าย" button.
  if (room.matchDeadline && Date.now() >= room.matchDeadline && room.matchRoundsRemaining === null) {
    room.matchRoundsRemaining = LAST_ROUNDS_ON_TIME;
    room.matchDeadline = null;
  }
  if (matchLimitReached(room) ||
      (room.matchRoundsRemaining !== null && room.matchRoundsRemaining <= 0)) {
    room.phase = "gameover";
    room.finalCumulative = cumulativeScores(room);
    clearTimers(room);
    broadcastState(room.code);
    return;
  }
  // Whoever was multiplied gets to decide about a reseat -- see askNextSeatPrompt
  askNextSeatPrompt(room, seatPromptQueue(room));
}

// Everyone who was multiplied this round and is a real player who is still
// connected, the last leg of the next round first. A bot has nobody to ask, and
// a player who has dropped cannot answer (and will not be waited for).
function seatPromptQueue(room) {
  const leader = room.finished[0];
  return (room.lastMultiplierVictims || [])
    .filter(s => room.players[s] !== null && room.socketIds[s] !== null)
    .sort((a, b) => legOf(b, leader) - legOf(a, leader));
}

// Deals the next round: after a reseat if somebody asked for one, otherwise
// with the seats as they are. Last round's winner leads either way.
function proceedToNextRound(room, reseat) {
  room.seatPrompt = null;
  const winnerOldSeat = room.finished[0];
  if (reseat) beginSeatDraw(room, room.round + 1, winnerOldSeat);
  else startRound(room, winnerOldSeat);
  broadcastState(room.code);
}

// Asks the first player in the queue whether to redraw the seats; with nobody
// left to ask, deals on. Their answer -- or the clock running out, which counts
// as "no" -- comes back through answerSeatPrompt.
function askNextSeatPrompt(room, queue) {
  const eligible = queue.filter(s => room.players[s] !== null && room.socketIds[s] !== null);
  if (eligible.length === 0) return proceedToNextRound(room, false);
  const [seat, ...rest] = eligible;
  clearTimers(room);
  room.seatPrompt = {
    seat, leg: legOf(seat, room.finished[0]), until: Date.now() + SEAT_PROMPT_MS, queue: rest,
  };
  room.roundEndTimer = setTimeout(() => answerSeatPrompt(room, seat, false), SEAT_PROMPT_MS);
  broadcastState(room.code);
}

// "Yes" redraws the seats at once and nobody after them is asked -- one redraw
// is all it takes. "No" hands the question to the next player in the queue.
function answerSeatPrompt(room, seat, wantsReseat) {
  const prompt = room.seatPrompt;
  if (!prompt || prompt.seat !== seat || room.phase !== "finished") return false;
  clearTimers(room);
  if (wantsReseat) {
    proceedToNextRound(room, true);
  } else {
    room.seatPrompt = null;
    askNextSeatPrompt(room, prompt.queue);
  }
  return true;
}

function scheduleTurn(room) {
  clearTimers(room);
  if (room.phase !== "playing") return;
  const seat = room.turn;
  const isBot = room.players[seat] === null;
  const duration = turnDurationSeconds(room);
  if (isBot) {
    room.botTimer = setTimeout(() => botAct(room), 1200);
  } else if (pendingAutoPassSeat(room) === seat) {
    room.botTimer = setTimeout(() => autoPass(room, seat), AUTO_PASS_DELAY_MS);
  } else {
    room.turnTimer = setTimeout(() => autoTimeout(room), duration * 1000);
  }
}

// The seat the server should pass for: a real player, answering a trick, who
// holds fewer cards than the play on the table and so cannot beat it. Bots
// decide for themselves (they pass when they have nothing), and a player
// leading has to play, so neither is ever picked.
function pendingAutoPassSeat(room) {
  if (room.phase !== "playing" || room.paused) return null;
  const seat = room.turn;
  if (seat === null || seat === undefined || room.players[seat] === null) return null;
  if (room.lastPlayerSeat === null || room.lastPlayerSeat === seat || !room.lastPlay) return null;
  return cannotBeatByCount(room.hands[seat], room.lastPlay.cards) ? seat : null;
}

function autoPass(room, seat) {
  if (pendingAutoPassSeat(room) !== seat) return; // the situation changed while we waited
  applyPass(room, seat);
  broadcastState(room.code);
}

function applyPass(room, seat) {
  const newPassed = [...room.passedThisTrick, seat];
  const resolved = resolveNextTurn(room.finished, newPassed, room.lastPlayerSeat, seat);
  room.passedThisTrick = resolved.reset ? [] : newPassed;
  room.lastPlay = resolved.reset ? null : room.lastPlay;
  room.lastPlayerSeat = resolved.reset ? null : room.lastPlayerSeat;
  if (resolved.reset) room.trickPile = [];
  room.turn = resolved.nextTurn;
  room.turnStartedAt = Date.now();
  pushLog(room, `${room.players[seat] || `บอท ${seat + 1}`} ผ่าน`);
  scheduleTurn(room);
}

const ROUND_END_REVEAL_MS = 1600; // let the winning card sit visible on the table before the summary pops up

function applyPlay(room, seat, cards) {
  const hand = room.hands[seat];
  const selKeys = new Set(cards.map(cardKey));
  const newHand = hand.filter(c => !selKeys.has(cardKey(c)));
  room.hands[seat] = newHand;
  room.lastPlay = { cards, seat };
  room.lastPlayerSeat = seat;
  room.trickPile = [...room.trickPile, { cards, seat }];
  room.everPlayed = true;
  const label = room.players[seat] || `บอท ${seat + 1}`;
  pushLog(room, `${label} ลงไพ่ ${cards.map(c => c.rank + c.suit).join(" ")}`);

  if (newHand.length === 0) {
    // don't flip to "finished" immediately — this broadcast (triggered by
    // the caller right after applyPlay returns) shows the winning card
    // sitting on the table first; the summary appears after a short pause
    room.turn = null;
    clearTimers(room);
    room.roundEndTimer = setTimeout(() => finishRound(room, seat), ROUND_END_REVEAL_MS);
    return;
  }
  const resolved = resolveNextTurn(room.finished, room.passedThisTrick, seat, seat);
  room.turn = resolved.nextTurn;
  room.turnStartedAt = Date.now();
  scheduleTurn(room);
}

function finishRound(room, seat) {
  room.finished = [seat];
  room.phase = "finished";
  room.payout = computePayouts(room.hands);
  room.roundHistory.push({
    round: room.round, net: room.payout.net, scores: room.payout.scores,
    cardsLeft: room.hands.map(h => h.length), players: [...room.players],
    hands: room.hands.map(h => h.map(c => ({ rank: c.rank, suit: c.suit }))),
    // what everyone was dealt. Only ever attached to a round that is over --
    // roundHistory is written here, in finishRound, and nowhere else, so the
    // round being played cannot leak through the history screen.
    startingHands: room.startingHands || null,
  });
  room.lastMultiplierVictims = [0, 1, 2, 3].filter(s => room.hands[s].length >= 10);
  if (room.matchRoundsRemaining !== null) room.matchRoundsRemaining -= 1;
  broadcastState(room.code);
  clearTimers(room);
  room.roundEndTimer = setTimeout(() => advanceAfterRound(room), ROUND_RESULT_DELAY_MS);
}

function validateAndPlay(room, seat, cards) {
  if (room.paused) return { ok: false, error: "เกมกำลังพักอยู่" };
  if (room.phase !== "playing" || room.turn !== seat) return { ok: false, error: "ไม่ใช่ตาคุณ" };
  // The client is untrusted: it may send cards this seat does not hold, or the
  // same card twice. Check ownership before anything else looks at the cards.
  if (!handContainsAll(room.hands[seat], cards)) return { ok: false, error: "ไพ่ไม่ถูกต้อง" };
  const combo = classifyCombo(cards);
  if (!combo) return { ok: false, error: "ชุดไพ่นี้ไม่ถูกต้อง" };

  const isNewTrick = room.lastPlayerSeat === null;
  const prevCombo = isNewTrick ? null : classifyCombo(room.lastPlay.cards);
  const prevCards = isNewTrick ? null : room.lastPlay.cards;
  if (!comboBeats(combo, prevCombo, cards, prevCards || [])) {
    return { ok: false, error: "ไพ่ชุดนี้ไม่แรงพอ" };
  }
  // House rule: 3♣ decides WHO opens the first round, but the opener is free
  // to lead any legal combination -- the 3♣ need not be in it.
  if (combo.type === "single") {
    const forced = getForcedHighCard(
      { hands: room.hands, finished: room.finished, passedThisTrick: room.passedThisTrick, lastPlayerSeat: room.lastPlayerSeat, lastPlay: room.lastPlay },
      seat
    );
    if (forced && cardKey(cards[0]) !== cardKey(forced)) {
      return { ok: false, error: `ผู้เล่นถัดไปเหลือไพ่ใบเดียว ต้องลง ${forced.rank}${forced.suit}` };
    }
  }
  applyPlay(room, seat, cards);
  return { ok: true };
}

function validateAndPass(room, seat) {
  if (room.paused) return { ok: false, error: "เกมกำลังพักอยู่" };
  if (room.phase !== "playing" || room.turn !== seat) return { ok: false, error: "ไม่ใช่ตาคุณ" };
  if (room.lastPlayerSeat === null || room.lastPlayerSeat === seat) {
    return { ok: false, error: "คุณเป็นคนลงนำ ผ่านไม่ได้" };
  }
  const forced = getForcedHighCard(
    { hands: room.hands, finished: room.finished, passedThisTrick: room.passedThisTrick, lastPlayerSeat: room.lastPlayerSeat, lastPlay: room.lastPlay },
    seat
  );
  if (forced) return { ok: false, error: `ต้องลง ${forced.rank}${forced.suit} ผ่านไม่ได้` };
  applyPass(room, seat);
  return { ok: true };
}

// ---- simple bot AI ----
// ---- Strategic bot AI ----
// The bot sees the full room state (it's server-authoritative anyway) and
// uses that to play toward maximizing its own net chip outcome:
//  - generates every legal combo, including 5-card hands (straights,
//    flushes, full houses, quad+kicker, straight flushes)
//  - when leading, tries to block any opponent close to winning by checking
//    whether THEIR actual hand can beat the combo it's considering
//  - prioritizes clearing multiple cards at once once it's close to winning
//    itself, to finish fast
//  - conserves precious cards (2s/Aces) on low-stakes tricks when no one is
//    in immediate danger of winning, instead of always playing the cheapest
//    valid beat
function generateAllCombos(hand) {
  const tryPlays = [];
  hand.forEach(c => tryPlays.push({ cards: [c], combo: classifyCombo([c]) }));
  const byRank = {};
  hand.forEach(c => { (byRank[c.rank] ||= []).push(c); });
  Object.values(byRank).forEach(group => {
    if (group.length >= 2) {
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) {
          const cards = [group[i], group[j]];
          tryPlays.push({ cards, combo: classifyCombo(cards) });
        }
    }
    if (group.length >= 3) tryPlays.push({ cards: group.slice(0, 3), combo: classifyCombo(group.slice(0, 3)) });
    if (group.length >= 4) tryPlays.push({ cards: group.slice(0, 4), combo: classifyCombo(group.slice(0, 4)) });
  });
  find5CardCombos(hand).forEach(p => tryPlays.push(p));
  return tryPlays;
}

function sortByCheapest(list) {
  return [...list].sort((a, b) => a.cards.length - b.cards.length || a.combo.power[a.combo.power.length - 1] - b.combo.power[b.combo.power.length - 1]);
}

function botChooseMove(room, seat, prevCards, prevCombo) {
  const hand = room.hands[seat];
  const tryPlays = generateAllCombos(hand);
  const valid = sortByCheapest(tryPlays.filter(p => p.combo && comboBeats(p.combo, prevCombo, p.cards, prevCards || [])));
  if (valid.length === 0) return null;

  const others = [0, 1, 2, 3].filter(s => s !== seat && !room.finished.includes(s));
  const dangerSeats = others.filter(s => room.hands[s].length <= 2); // one or two cards from winning
  const victimSeats = others.filter(s => room.hands[s].length >= 10); // in or heading into the multiplier zone
  const myCount = hand.length;
  const myMultiplierZone = myCount >= 12 ? 3 : myCount >= 10 ? 2 : 1; // matches the actual scoring thresholds

  if (!prevCombo) {
    // LEADING — free choice of any combo type
    if (dangerSeats.length > 0) {
      // try to find a lead that NONE of the dangerous opponents can beat,
      // checking their actual hands (cheapest/smallest options first)
      const blockCandidates = sortByCheapest(valid.filter(p => p.cards.length >= 2));
      for (const opt of blockCandidates) {
        const someoneCanBeatIt = dangerSeats.some(ds => {
          const theirOptions = generateAllCombos(room.hands[ds]);
          return theirOptions.some(o => o.combo && comboBeats(o.combo, opt.combo, o.cards, opt.cards));
        });
        if (!someoneCanBeatIt) return opt.cards;
      }
    }
    // loss minimization: escaping the 2x/3x multiplier zone is worth
    // shedding cards aggressively for, same urgency as an actual endgame
    if (myMultiplierZone > 1 || myCount <= 6) {
      // endgame — shed as many cards as possible per play to finish fast
      const multi = [...valid.filter(p => p.cards.length >= 2)]
        .sort((a, b) => b.cards.length - a.cards.length || a.combo.power[a.combo.power.length - 1] - b.combo.power[b.combo.power.length - 1]);
      if (multi.length) return multi[0].cards;
    }
    // default: mostly lead cheap singles, sometimes shed a pair/triple/5-set
    // for variety — but never waste a genuinely strong combo (containing a
    // 2, Ace, or King) here just for variety when there's no urgency; those
    // are only worth using via the blocking/multiplier-escape/endgame logic
    // above. If literally the only options left ARE strong, fall through.
    const isPrecious = (cards) => cards.some(c => c.rank === "2" || c.rank === "A" || c.rank === "K");
    const singles = valid.filter(p => p.cards.length === 1);
    const pairs = valid.filter(p => p.cards.length === 2 && !isPrecious(p.cards));
    const triples = valid.filter(p => p.cards.length === 3 && !isPrecious(p.cards));
    const fives = valid.filter(p => p.cards.length === 5 && !isPrecious(p.cards));
    const roll = Math.random();
    if (roll < 0.55 || (pairs.length === 0 && fives.length === 0 && triples.length === 0)) {
      return singles.length ? singles[0].cards : valid[0].cards;
    }
    if (roll < 0.8 && pairs.length) return pairs[0].cards;
    if (roll < 0.93 && fives.length) return fives[0].cards;
    if (triples.length) return triples[0].cards;
    return singles.length ? singles[0].cards : valid[0].cards;
  }

  // RESPONDING to an active trick
  const ownerSeat = room.lastPlayerSeat;
  const ownerCount = ownerSeat !== null && ownerSeat !== undefined ? room.hands[ownerSeat].length : 99;
  const ownerDangerous = ownerCount <= 3;
  const cheapest = valid[0];
  const usesPreciousCard = cheapest.cards.some(c => c.rank === "2" || c.rank === "A");

  // 1) self-preservation first: if beating this trick helps escape the
  //    multiplier zone, do it regardless of card cost — a 2 or Ace burned
  //    now is worth far less than the penalty of staying stuck at x2/x3
  if (myMultiplierZone > 1) return cheapest.cards;

  // 2) strategic pass: the current leader is about to win, and some OTHER
  //    opponent (not the leader, not me) is already stuck with a lot of
  //    cards — better to let the leader finish the round right now and
  //    lock in that opponent's bad position than to extend the trick and
  //    give them more chances to unload cards before it ends
  if (ownerDangerous && myCount > 3) {
    const otherVictims = victimSeats.filter(s => s !== ownerSeat);
    if (otherVictims.length > 0) return null;
  }

  // 3) conserve strength: no one is in immediate danger, it's still early,
  //    and the only way to beat this trick burns a precious card — not
  //    worth it, save it for later
  if (!ownerDangerous && dangerSeats.length === 0 && myCount > 7 && usesPreciousCard) {
    return null;
  }

  return cheapest.cards;
}

function botAct(room) {
  if (room.phase !== "playing") return;
  const seat = room.turn;
  const hand = room.hands[seat];
  const isNewTrick = room.lastPlayerSeat === null;
  const prevCards = isNewTrick ? null : room.lastPlay.cards;
  const prevCombo = prevCards ? classifyCombo(prevCards) : null;
  let move = botChooseMove(room, seat, prevCards, prevCombo);

  if (!move && isNewTrick) move = [hand[0]];

  const forced = getForcedHighCard(
    { hands: room.hands, finished: room.finished, passedThisTrick: room.passedThisTrick, lastPlayerSeat: room.lastPlayerSeat, lastPlay: room.lastPlay },
    seat
  );
  if (forced && (!move || (move.length === 1 && cardKey(move[0]) !== cardKey(forced)))) move = [forced];

  if (!move) applyPass(room, seat);
  else applyPlay(room, seat, move);

  broadcastState(room.code);
}

function autoTimeout(room) {
  if (room.phase !== "playing") return;
  const seat = room.turn;
  const move = autoTimeoutMove(
    { hands: room.hands, finished: room.finished, passedThisTrick: room.passedThisTrick, lastPlayerSeat: room.lastPlayerSeat, lastPlay: room.lastPlay },
    seat
  );
  if (move) applyPlay(room, seat, move);
  else applyPass(room, seat);
  broadcastState(room.code);
}

io.on("connection", (socket) => {
  // Drop packets from anyone firing events faster than a human could.
  socket.use(([event], next) => {
    if (withinRateLimit(socket, event)) return next();
    socket.emit("actionError", "ส่งคำสั่งถี่เกินไป รอสักครู่");
    next(new Error("rate limited"));
  });
  socket.on("error", () => {}); // a dropped packet must not kill the connection

  // Asked for by the lobby screen; the default rate limit is enough for a
  // refresh button, and the reply carries nothing a stranger could act on.
  socket.on("listRooms", (_payload, cb) => {
    if (typeof cb === "function") cb({ ok: true, rooms: activeRoomSummaries() });
  });

  // Watching a game from the lobby board. No name, no seat, no chat: the
  // observer is not in socketIds, so every action handler here already turns
  // them away at `seat === -1`, and they never join the socket.io room, so the
  // table's chat and voice traffic does not reach them either.
  socket.on("observeRoom", ({ watchId }, cb) => {
    const reply = typeof cb === "function" ? cb : () => {};
    const room = [...rooms.values()].find(r => r.watchId === watchId);
    if (!room) return reply({ ok: false, error: "ไม่พบห้องนี้" });
    if (seatOf(room, socket.id) !== -1) return reply({ ok: false, error: "คุณนั่งอยู่ในห้องนี้แล้ว" });
    stopObserving(socket.id); // one game at a time, or two states would fight
    room.observers.add(socket.id);
    reply({ ok: true }); // deliberately not the code -- see sanitizeForSeat
    broadcastState(room.code); // sends the watcher their first state, and tells
                               // the players their viewer count just went up
  });

  // The history screen, fetched only when it is opened. Finished rounds only,
  // so the hands in it are all cards that have already been shown.
  socket.on("getHistory", (_payload, cb) => {
    if (typeof cb !== "function") return;
    const room = roomOf(socket.id);
    cb({ ok: !!room, roundHistory: room ? room.roundHistory : [] });
  });

  // The answer to "redraw the seats?" -- only the player being asked counts.
  socket.on("answerSeatDraw", ({ code, choice }) => {
    const room = rooms.get(code);
    if (!room) return;
    const seat = seatOf(room, socket.id);
    if (seat === -1) return;
    answerSeatPrompt(room, seat, choice === true); // broadcasts by itself; anyone but the player asked is ignored
  });

  socket.on("stopObserving", () => {
    const code = stopObserving(socket.id);
    if (code) broadcastState(code);
  });

  socket.on("createRoom", ({ name }, cb) => {
    const code = makeRoomCode();
    const room = newRoomState(name?.trim() || "Player", socket.id);
    room.code = code;
    room.seatTokens[0] = makeSeatToken();
    room.hostToken = room.seatTokens[0];
    rooms.set(code, room);
    socket.join(code);
    cb({ ok: true, code, seat: 0, token: room.seatTokens[0] });
    broadcastState(code);
  });

  socket.on("joinRoom", ({ name, code, token }, cb) => {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return cb({ ok: false, error: "ไม่พบห้องนี้" });
    const wanted = (name || "").trim();
    if (!wanted) return cb({ ok: false, error: "ใส่ชื่อก่อนครับ" });

    // The token is the reliable half of "who are you": the server issued it to
    // this seat and that browser kept it. The name is only what a human typed,
    // and a phone keyboard capitalises the first letter on its own -- so the
    // second visit used to look like a stranger, find no free seat, and be
    // told "ห้องเต็มแล้ว" while the player's own seat sat there waiting.
    let seat = token ? room.seatTokens.findIndex(t => t && t === token) : -1;
    if (seat === -1) seat = room.players.findIndex(p => p && sameName(p, wanted));
    if (seat !== -1) {
      // A seat is guarded only while somebody is actually connected to it: that
      // is the case the token was added for -- nobody may sit down on a player
      // who is sitting there playing. Once that connection is gone the name is
      // enough, because the token lives in one browser's storage and a dropped
      // player is often coming back from another one (a different browser, an
      // in-app one, or after the storage was cleared). Guarding an empty seat
      // any harder only ever locked its own owner out.
      if (room.socketIds[seat] !== null && room.seatTokens[seat] && room.seatTokens[seat] !== token) {
        return cb({ ok: false, error: "ชื่อนี้มีคนใช้อยู่ในห้องแล้ว ใช้ชื่ออื่นนะครับ" });
      }
      // The token is deliberately NOT rotated here: the player's other browser
      // may still be holding the old one, and it should keep working.
      if (!room.seatTokens[seat]) room.seatTokens[seat] = makeSeatToken();
      // The stored spelling is deliberately left alone: roundHistory keys the
      // running score by name, so renaming a seat mid-match would zero it.
    } else {
      seat = room.players.findIndex(p => p === null);
      if (seat === -1) {
        // Name the seats nobody is connected to. Whoever is being turned away
        // is most likely one of them, typing a different name than the one
        // their seat is still holding -- so the way back in is on the screen.
        const away = room.players.filter((p, s) => p && room.socketIds[s] === null);
        return cb({ ok: false, error: away.length
          ? `ห้องเต็มแล้ว — ถ้าคุณคือคนที่หลุดไป ใส่ชื่อเดิม (${away.join(", ")}) แล้วลองใหม่`
          : "ห้องเต็มแล้ว" });
      }
      room.players[seat] = wanted;
      room.seatTokens[seat] = makeSeatToken();
    }
    room.socketIds[seat] = socket.id;
    cancelRoomCleanup(room); // somebody is back — the room is no longer abandoned
    socket.join(room.code);
    cb({ ok: true, code: room.code, seat, token: room.seatTokens[seat] });
    if (room.chat && room.chat.length) socket.emit("chatHistory", room.chat);
    broadcastState(room.code);
  });

  // Getting up from the table on purpose, as opposed to dropping out. A drop
  // keeps the seat reserved so the player can come back to their hand; leaving
  // has to actually free it, or the seat sits there holding their name and the
  // room answers "ห้องเต็มแล้ว" when they try to come back later.
  socket.on("leaveRoom", (_payload, cb) => {
    const reply = typeof cb === "function" ? cb : () => {};
    for (const room of rooms.values()) {
      const seat = seatOf(room, socket.id);
      if (seat === -1) continue;
      const leavingToken = room.seatTokens[seat];
      room.players[seat] = null; // an empty seat is played by a bot from here on
      room.seatTokens[seat] = null;
      // The host getting up from the table hands the role to the lowest occupied
      // seat right now -- and it STAYS with that player from then on, instead of
      // moving every time the seats are redrawn.
      if (leavingToken && leavingToken === room.hostToken) {
        const next = room.players.findIndex(p => p !== null);
        room.hostToken = next === -1 ? null : room.seatTokens[next];
      }
      room.socketIds[seat] = null;
      if (room.voiceSockets && room.voiceSockets.delete(socket.id)) {
        room.voiceSockets.forEach(id => io.sockets.sockets.get(id)?.emit("voicePeerLeft", { id: socket.id }));
      }
      socket.leave(room.code); // no more chat or voice traffic for this socket
      // If it was their turn, the seat is a bot now: re-arm the clock so it
      // plays straight away instead of running the human turn timer out.
      if (room.phase === "playing" && room.turn === seat && !room.paused) scheduleTurn(room);
      // ...and if the table was waiting on their answer about a reseat, they
      // are gone: that is a "no", and the question moves on
      answerSeatPrompt(room, seat, false);
      scheduleRoomCleanup(room); // no-op unless that was the last player
      broadcastState(room.code);
      break;
    }
    reply({ ok: true });
  });

  socket.on("startGame", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "waiting") return;
    if (!isHost(room, seatOf(room, socket.id))) return;
    // a "stop after N rounds" limit is just the countdown, armed at kickoff
    room.matchRoundsRemaining =
      room.matchLimit && room.matchLimit.type === "rounds" ? room.matchLimit.value : null;
    room.matchDeadline = room.matchLimit && room.matchLimit.type === "time"
      ? Date.now() + room.matchLimit.value * MATCH_TIME_UNIT_MS : null;
    beginSeatDraw(room, 1, null); // always draw seats before the very first round
    broadcastState(code);
  });

  // "4 ตาสุดท้าย" — commits the room to ending after 4 more completed rounds
  socket.on("startLastRounds", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (!isHost(room, seatOf(room, socket.id))) return;
    room.matchRoundsRemaining = 4;
    broadcastState(code);
  });

  socket.on("playCards", ({ code, cards }) => {
    const room = rooms.get(code);
    if (!room) return;
    const seat = seatOf(room, socket.id);
    if (seat === -1) return;
    const result = validateAndPlay(room, seat, cards);
    if (result.ok) broadcastState(code);
    else io.sockets.sockets.get(socket.id)?.emit("actionError", result.error);
  });

  socket.on("pass", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    const seat = seatOf(room, socket.id);
    if (seat === -1) return;
    const result = validateAndPass(room, seat);
    if (result.ok) broadcastState(code);
    else io.sockets.sockets.get(socket.id)?.emit("actionError", result.error);
  });

  // Starts a fresh match in the same room (after "gameover"), same players/seats.
  socket.on("restartMatch", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "gameover") return;
    if (!isHost(room, seatOf(room, socket.id))) return;
    room.round = 0;
    room.roundHistory = [];
    room.matchRoundsRemaining = null; // both re-armed by startGame from matchLimit
    room.matchDeadline = null;
    room.finalCumulative = null;
    room.lastMultiplierVictims = [];
    room.phase = "waiting";
    broadcastState(code);
  });

  // Chosen in the waiting room, before the first deal.
  socket.on("setMatchLimit", ({ code, type, value }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "waiting") return;
    if (!isHost(room, seatOf(room, socket.id))) return;
    if (type !== "rounds" && type !== "points" && type !== "time") {
      room.matchLimit = null; // anything else means "no limit"
    } else {
      const n = Math.floor(Number(value));
      const max = type === "time" ? 1440 : 100000; // a day is plenty for one sitting
      if (!Number.isFinite(n) || n < 1 || n > max) return;
      room.matchLimit = { type, value: n };
    }
    broadcastState(code);
  });

  // Any seated player may call a break, and any of them may end it.
  socket.on("pauseGame", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    const seat = seatOf(room, socket.id);
    if (seat === -1) return;
    if (pauseRoom(room, seat)) broadcastState(code);
  });

  socket.on("resumeGame", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (seatOf(room, socket.id) === -1) return;
    if (resumeRoom(room)) broadcastState(code);
  });

  socket.on("chatMessage", ({ code, text }) => {
    const room = rooms.get(code);
    if (!room) return;
    const seat = seatOf(room, socket.id);
    if (seat === -1) return;
    const trimmed = (text || "").trim().slice(0, 200); // keep messages short
    if (!trimmed) return;
    const msg = { seat, name: room.players[seat] || `บอท ${seat + 1}`, text: trimmed, at: Date.now() };
    room.chat = room.chat || [];
    room.chat.push(msg);
    if (room.chat.length > 100) room.chat = room.chat.slice(-100); // keep it bounded
    io.to(code).emit("chatMessage", msg);
  });

  // ---- Voice chat signaling relay ----
  // The server never sees/handles audio itself — it only relays small
  // WebRTC handshake messages between specific peers so their browsers can
  // set up a direct peer-to-peer audio connection (low latency).
  socket.on("voiceJoin", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    room.voiceSockets = room.voiceSockets || new Set();
    const existing = [...room.voiceSockets];
    room.voiceSockets.add(socket.id);
    socket.emit("voicePeers", existing); // tell the newcomer who's already in voice chat
    existing.forEach(id => io.sockets.sockets.get(id)?.emit("voicePeerJoined", { id: socket.id }));
  });

  socket.on("voiceLeave", ({ code }) => {
    const room = rooms.get(code);
    if (!room || !room.voiceSockets) return;
    room.voiceSockets.delete(socket.id);
    room.voiceSockets.forEach(id => io.sockets.sockets.get(id)?.emit("voicePeerLeft", { id: socket.id }));
  });

  socket.on("voiceSignal", ({ to, data }) => {
    io.sockets.sockets.get(to)?.emit("voiceSignal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    const watched = stopObserving(socket.id);
    if (watched) broadcastState(watched);
    for (const room of rooms.values()) {
      const seat = seatOf(room, socket.id);
      if (seat !== -1) {
        room.socketIds[seat] = null; // seat stays reserved by name; bot fills turns meanwhile
        answerSeatPrompt(room, seat, false); // nobody left to answer a pending reseat question
        scheduleRoomCleanup(room);   // no-op unless that was the last player
      }
      if (room.voiceSockets && room.voiceSockets.has(socket.id)) {
        room.voiceSockets.delete(socket.id);
        room.voiceSockets.forEach(id => io.sockets.sockets.get(id)?.emit("voicePeerLeft", { id: socket.id }));
      }
    }
  });
});

// Started directly (npm start, Render) it listens. Required from a test it does
// not: the test starts it on a port of its own, and reaches into the rooms to
// set up situations that a random deal would take hours to produce.
if (require.main === module) {
  server.listen(PORT, () => console.log(`Big2 server running on port ${PORT}`));
}

module.exports = {
  server, io, rooms,
  newRoomState, sanitizeForSeat, broadcastState, makeSeatToken,
  startRound, applyPlay, applyPass, finishRound, advanceAfterRound,
  scheduleTurn, pendingAutoPassSeat, seatPromptQueue, answerSeatPrompt,
  botAct, autoTimeout, clearTimers, isHost, hostSeatOf,
};
