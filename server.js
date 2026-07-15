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
  cardKey, dealFour, findStartPlayer, classifyCombo, comboBeats,
  computePayouts, resolveNextTurn, getForcedHighCard,
} = require("./gameLogic");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 30;

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
    phase: "waiting", // waiting | playing | finished
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
    botTimer: null,
    turnTimer: null,
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
  const totals = [0, 0, 0, 0];
  room.roundHistory.forEach(r => { r.net.forEach((v, i) => { totals[i] += v; }); });
  return totals;
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
    allHands: room.phase === "finished" ? room.hands : null,
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
  };
}

function clearTimers(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
}

function startRound(room, forcedLeaderSeat) {
  const hands = dealFour();
  const startSeat = (forcedLeaderSeat !== null && forcedLeaderSeat !== undefined) ? forcedLeaderSeat : findStartPlayer(hands);
  room.phase = "playing";
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
    clearTimers(room);
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
  scheduleTurn(room);
}

function autoTimeout(room) {
  if (room.phase !== "playing") return;
  const seat = room.turn;
  const hand = room.hands[seat];
  let move = null;
  if (room.lastPlayerSeat === null || room.lastPlayerSeat === seat) {
    move = [[...hand].sort((a, b) => require("./gameLogic").cardValue(a) - require("./gameLogic").cardValue(b))[0]];
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
  scheduleTurn(room);
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
    broadcastState(room.code);
  });

  socket.on("startGame", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "waiting") return;
    startRound(room, null);
    broadcastState(code);
  });

  socket.on("playCards", ({ code, cards }) => {
    const room = rooms.get(code);
    if (!room) return;
    const seat = seatOf(room, socket.id);
    if (seat === -1) return;
    const result = validateAndPlay(room, seat, cards);
    if (result.ok) { broadcastState(code); scheduleTurn(room); }
    else io.sockets.sockets.get(socket.id)?.emit("actionError", result.error);
  });

  socket.on("pass", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    const seat = seatOf(room, socket.id);
    if (seat === -1) return;
    const result = validateAndPass(room, seat);
    if (result.ok) { broadcastState(code); scheduleTurn(room); }
    else io.sockets.sockets.get(socket.id)?.emit("actionError", result.error);
  });

  socket.on("nextRound", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "finished") return;
    const winnerSeat = room.finished[0];
    startRound(room, winnerSeat);
    broadcastState(code);
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const seat = seatOf(room, socket.id);
      if (seat !== -1) room.socketIds[seat] = null; // seat stays reserved by name; bot fills turns meanwhile
    }
  });
});

server.listen(PORT, () => console.log(`Big2 server running on port ${PORT}`));
