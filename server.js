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
  cardKey, cardValue, dealFour, findStartPlayer, classifyCombo, comboBeats,
  computePayouts, resolveNextTurn, getForcedHighCard,
  drawSeatCards, seatDrawOrder, fillRemainingSeats, seatDrawTriggered,
} = require("./gameLogic");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 30;
const ROUND_RESULT_DELAY_MS = 4000; // how long the round-result overlay stays up before auto-continuing
const SEAT_DRAW_STEP_MS = 300; // how fast each seat-draw pick auto-resolves
const SEAT_DRAW_MIN_DISPLAY_MS = 2000; // seat-draw screen always shows for at least this long

// rooms: code -> room object (kept in memory; resets if the server restarts)
const rooms = new Map();

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
    matchRoundsRemaining: null, // null = play forever; a number = "last N rounds" mode
    finalCumulative: null,
    botTimer: null,
    turnTimer: null,
    roundEndTimer: null,
    seatDrawTimer: null,
  };
}

function seatOf(room, socketId) {
  return room.socketIds.findIndex(id => id === socketId);
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
    code: room.code,
    phase: room.phase,
    players: room.players,
    mySeat: seat,
    myHand: room.hands[seat] || [],
    handCounts: room.hands.map(h => h.length),
    // reveal everyone's actual hands only once the round is over — never during active play
    allHands: (room.phase === "finished" || room.phase === "gameover") ? room.hands : null,
    turn: room.turn,
    turnStartedAt: room.turnStartedAt,
    turnSeconds: TURN_SECONDS,
    lastPlayerSeat: room.lastPlayerSeat,
    passedThisTrick: room.passedThisTrick,
    trickPile: room.trickPile,
    finished: room.finished,
    round: room.round,
    roundHistory: room.roundHistory,
    cumulative: cumulativeScores(room),
    payout: room.payout,
    everPlayed: room.everPlayed,
    seatDraw: room.seatDraw,
    matchRoundsRemaining: room.matchRoundsRemaining,
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
    const newPlayers = [null, null, null, null];
    const newSocketIds = [null, null, null, null];
    [0, 1, 2, 3].forEach(oldSeat => {
      newPlayers[picks[oldSeat]] = sd.playersAtDraw[oldSeat];
      newSocketIds[picks[oldSeat]] = sd.socketIdsAtDraw[oldSeat];
    });
    room.players = newPlayers;
    room.socketIds = newSocketIds;
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
function advanceAfterRound(room) {
  if (room.phase !== "finished") return;
  if (room.matchRoundsRemaining !== null && room.matchRoundsRemaining <= 0) {
    room.phase = "gameover";
    room.finalCumulative = cumulativeScores(room);
    clearTimers(room);
    broadcastState(room.code);
    return;
  }
  const winnerOldSeat = room.finished[0];
  const newRound = room.round + 1;
  if (seatDrawTriggered(room.lastMultiplierVictims || [], winnerOldSeat)) {
    beginSeatDraw(room, newRound, winnerOldSeat);
  } else {
    startRound(room, winnerOldSeat);
  }
  broadcastState(room.code);
}

function scheduleTurn(room) {
  clearTimers(room);
  if (room.phase !== "playing") return;
  const seat = room.turn;
  const isBot = room.players[seat] === null;
  if (isBot) {
    room.botTimer = setTimeout(() => botAct(room), 1200);
  } else {
    room.turnTimer = setTimeout(() => autoTimeout(room), TURN_SECONDS * 1000);
  }
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
  room.log.push(`${room.players[seat] || `บอท ${seat + 1}`} ผ่าน`);
  scheduleTurn(room);
}

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
  room.log.push(`${label} ลงไพ่ ${cards.map(c => c.rank + c.suit).join(" ")}`);

  if (newHand.length === 0) {
    room.finished = [seat];
    room.phase = "finished";
    room.turn = null;
    room.payout = computePayouts(room.hands);
    room.roundHistory.push({
      round: room.round, net: room.payout.net, scores: room.payout.scores,
      cardsLeft: room.hands.map(h => h.length), players: [...room.players],
    });
    room.lastMultiplierVictims = [0, 1, 2, 3].filter(s => room.hands[s].length >= 10);
    if (room.matchRoundsRemaining !== null) room.matchRoundsRemaining -= 1;
    clearTimers(room);
    room.roundEndTimer = setTimeout(() => advanceAfterRound(room), ROUND_RESULT_DELAY_MS);
    return;
  }
  const resolved = resolveNextTurn(room.finished, room.passedThisTrick, seat, seat);
  room.turn = resolved.nextTurn;
  room.turnStartedAt = Date.now();
  scheduleTurn(room);
}

function validateAndPlay(room, seat, cards) {
  if (room.phase !== "playing" || room.turn !== seat) return { ok: false, error: "ไม่ใช่ตาคุณ" };
  const combo = classifyCombo(cards);
  if (!combo) return { ok: false, error: "ชุดไพ่นี้ไม่ถูกต้อง" };

  const isNewTrick = room.lastPlayerSeat === null;
  const prevCombo = isNewTrick ? null : classifyCombo(room.lastPlay.cards);
  const prevCards = isNewTrick ? null : room.lastPlay.cards;
  if (!comboBeats(combo, prevCombo, cards, prevCards || [])) {
    return { ok: false, error: "ไพ่ชุดนี้ไม่แรงพอ" };
  }
  if (room.round === 1 && !room.everPlayed) {
    if (!cards.some(c => c.rank === "3" && c.suit === "♣")) {
      return { ok: false, error: "ตาแรกของเกมต้องมีไพ่ 3♣" };
    }
  }
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
function botChooseMove(hand, prevCards, prevCombo) {
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
  const valid = tryPlays.filter(p => p.combo && comboBeats(p.combo, prevCombo, p.cards, prevCards || []));
  if (valid.length === 0) return null;
  valid.sort((a, b) => a.cards.length - b.cards.length || a.combo.power[a.combo.power.length - 1] - b.combo.power[b.combo.power.length - 1]);
  if (!prevCombo) {
    const singles = valid.filter(p => p.cards.length === 1);
    return singles.length ? singles[0].cards : valid[0].cards;
  }
  return valid[0].cards;
}

function botAct(room) {
  if (room.phase !== "playing") return;
  const seat = room.turn;
  const hand = room.hands[seat];
  const isNewTrick = room.lastPlayerSeat === null;
  const prevCards = isNewTrick ? null : room.lastPlay.cards;
  const prevCombo = prevCards ? classifyCombo(prevCards) : null;
  let move = botChooseMove(hand, prevCards, prevCombo);

  if (room.round === 1 && !room.everPlayed) {
    const has3c = hand.some(c => c.rank === "3" && c.suit === "♣");
    if (has3c && (!move || !move.some(c => c.rank === "3" && c.suit === "♣"))) {
      move = [hand.find(c => c.rank === "3" && c.suit === "♣")];
    }
  }
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
  const hand = room.hands[seat];
  let move = null;
  if (room.lastPlayerSeat === null || room.lastPlayerSeat === seat) {
    move = [[...hand].sort((a, b) => cardValue(a) - cardValue(b))[0]];
  } else {
    const forced = getForcedHighCard(
      { hands: room.hands, finished: room.finished, passedThisTrick: room.passedThisTrick, lastPlayerSeat: room.lastPlayerSeat, lastPlay: room.lastPlay },
      seat
    );
    if (forced) move = [forced];
  }
  if (move) applyPlay(room, seat, move);
  else applyPass(room, seat);
  broadcastState(room.code);
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }, cb) => {
    const code = makeRoomCode();
    const room = newRoomState(name?.trim() || "Player", socket.id);
    room.code = code;
    rooms.set(code, room);
    socket.join(code);
    cb({ ok: true, code });
    broadcastState(code);
  });

  socket.on("joinRoom", ({ name, code }, cb) => {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return cb({ ok: false, error: "ไม่พบห้องนี้" });
    let seat = room.players.findIndex(p => p === (name || "").trim());
    if (seat === -1) {
      seat = room.players.findIndex(p => p === null);
      if (seat === -1) return cb({ ok: false, error: "ห้องเต็มแล้ว" });
      room.players[seat] = (name || "").trim();
    }
    room.socketIds[seat] = socket.id;
    socket.join(room.code);
    cb({ ok: true, code: room.code, seat });
    if (room.chat && room.chat.length) socket.emit("chatHistory", room.chat);
    broadcastState(room.code);
  });

  socket.on("startGame", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "waiting") return;
    beginSeatDraw(room, 1, null); // always draw seats before the very first round
    broadcastState(code);
  });

  // "4 ตาสุดท้าย" — commits the room to ending after 4 more completed rounds
  socket.on("startLastRounds", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
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
    room.round = 0;
    room.roundHistory = [];
    room.matchRoundsRemaining = null;
    room.finalCumulative = null;
    room.lastMultiplierVictims = [];
    room.phase = "waiting";
    broadcastState(code);
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

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const seat = seatOf(room, socket.id);
      if (seat !== -1) room.socketIds[seat] = null; // seat stays reserved by name; bot fills turns meanwhile
    }
  });
});

server.listen(PORT, () => console.log(`Big2 server running on port ${PORT}`));
