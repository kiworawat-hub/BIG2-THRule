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
  find5CardCombos,
} = require("./gameLogic");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 30; // responding to an active trick
const LEAD_TURN_SECONDS = 45; // leading a fresh trick — more to think through
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
    players: [hostName, "บอท 2", "บอท 3", "บอท 4"], // every seat has a persistent display name, human or bot
    isBot: [false, true, true, true], // which seats are AI-controlled — this is what actually drives bot behavior, not the name
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
  const totals = [0, 0, 0, 0];
  room.roundHistory.forEach(r => {
    const rowPlayers = r.players || room.players;
    room.players.forEach((name, colSeat) => {
      const idx = rowPlayers.indexOf(name);
      if (idx !== -1) totals[colSeat] += r.net[idx];
    });
  });
  return totals;
}

function sanitizeForSeat(room, seat) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players,
    isBot: room.isBot,
    mySeat: seat,
    myHand: room.hands[seat] || [],
    handCounts: room.hands.map(h => h.length),
    // reveal everyone's actual hands only once the round is over — never during active play
    allHands: (room.phase === "finished" || room.phase === "gameover") ? room.hands : null,
    turn: room.turn,
    turnStartedAt: room.turnStartedAt,
    turnSeconds: room.lastPlayerSeat === null ? LEAD_TURN_SECONDS : TURN_SECONDS,
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
    isBotAtDraw: [...room.isBot],
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
    const newIsBot = [null, null, null, null];
    [0, 1, 2, 3].forEach(oldSeat => {
      newPlayers[picks[oldSeat]] = sd.playersAtDraw[oldSeat];
      newSocketIds[picks[oldSeat]] = sd.socketIdsAtDraw[oldSeat];
      newIsBot[picks[oldSeat]] = sd.isBotAtDraw[oldSeat];
    });
    room.players = newPlayers;
    room.socketIds = newSocketIds;
    room.isBot = newIsBot;
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
  const isBot = room.isBot[seat];
  const duration = room.lastPlayerSeat === null ? LEAD_TURN_SECONDS : TURN_SECONDS;
  if (isBot) {
    room.botTimer = setTimeout(() => botAct(room), 1200);
  } else {
    room.turnTimer = setTimeout(() => autoTimeout(room), duration * 1000);
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
  room.log.push(`${room.players[seat]} ผ่าน`);
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
  const label = room.players[seat];
  room.log.push(`${label} ลงไพ่ ${cards.map(c => c.rank + c.suit).join(" ")}`);

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
  });
  room.lastMultiplierVictims = [0, 1, 2, 3].filter(s => room.hands[s].length >= 10);
  if (room.matchRoundsRemaining !== null) room.matchRoundsRemaining -= 1;
  broadcastState(room.code);
  clearTimers(room);
  room.roundEndTimer = setTimeout(() => advanceAfterRound(room), ROUND_RESULT_DELAY_MS);
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
  const counts = {};
  others.forEach(s => { counts[s] = room.hands[s].length; });
  const dangerSeats = others.filter(s => counts[s] <= 2); // one or two cards from winning
  const victimSeats = others.filter(s => counts[s] >= 10); // in or heading into the multiplier zone
  const myCount = hand.length;
  const myMultiplierZone = myCount >= 12 ? 3 : myCount >= 10 ? 2 : 1; // matches the actual scoring thresholds
  const minOtherCount = others.length ? Math.min(...others.map(s => counts[s])) : 99;

  function opponentCanBeat(oppSeat, combo, cards) {
    const theirOptions = generateAllCombos(room.hands[oppSeat]);
    return theirOptions.some(o => o.combo && comboBeats(o.combo, combo, o.cards, cards));
  }
  function findUnbeatableLead(candidates, targetSeats) {
    for (const opt of candidates) {
      if (!targetSeats.some(ts => opponentCanBeat(ts, opt.combo, opt.cards))) return opt;
    }
    return null;
  }

  if (!prevCombo) {
    // LEADING — free choice of any combo type
    const iCannotWin = others.length > 0 && others.every(s => counts[s] < myCount);
    const shouldHelpNearWinner = dangerSeats.length > 0 && victimSeats.length > 0 && iCannotWin && myMultiplierZone === 1;

    if (shouldHelpNearWinner) {
      // I have no realistic path to winning this round myself, and a
      // genuine victim is stuck with a lot of cards. Blocking the near
      // winner here would only drag the round out without ever benefiting
      // me — better to hand them an easy single to respond to and help
      // them finish fast, locking in the victim's bad position. A pair or
      // bigger combo risks being something they can't answer, stalling
      // their progress for nothing.
      const singles = valid.filter(p => p.cards.length === 1);
      if (singles.length) return singles[0].cards;
    }

    // Deny a middle victim a turn entirely: if the very next player to act
    // (right after my lead) is a victim, and a near winner exists further
    // down the rotation, lead my strongest single they can't beat. They're
    // forced to pass without ever getting a shot at shedding a card this
    // trick — even if I don't know their exact hand, denying them the turn
    // outright protects the multiplier regardless of what they're holding.
    if (!shouldHelpNearWinner && victimSeats.length > 0 && dangerSeats.length > 0) {
      const nextActor = resolveNextTurn(room.finished, [], seat, seat).nextTurn;
      if (victimSeats.includes(nextActor)) {
        const strongestFirst = valid.filter(p => p.cards.length === 1).sort((a, b) => b.combo.power[1] - a.combo.power[1]);
        const deny = strongestFirst.find(opt => !opponentCanBeat(nextActor, opt.combo, opt.cards));
        if (deny) return deny.cards;
      }
    }

    if (!shouldHelpNearWinner && dangerSeats.length > 0) {
      // try to find a lead that NONE of the dangerous opponents can beat,
      // checking their actual hands (cheapest/smallest options first)
      const blockCandidates = sortByCheapest(valid.filter(p => p.cards.length >= 2));
      const block = findUnbeatableLead(blockCandidates, dangerSeats);
      if (block) return block.cards;
    }

    // I'm already stuck in the multiplier zone myself — misery loves
    // company. Hindering an opponent who's AHEAD of me (fewer cards) from
    // clearing out easily doesn't reduce what I owe the eventual winner,
    // but it drags that opponent's own final count up, which helps me in
    // every pairwise comparison against them specifically.
    if (myMultiplierZone > 1) {
      const aheadSeats = others.filter(s => counts[s] < myCount);
      if (aheadSeats.length > 0) {
        const hinderCandidates = sortByCheapest(valid.filter(p => p.cards.length >= 2));
        const hinder = findUnbeatableLead(hinderCandidates, aheadSeats);
        if (hinder) return hinder.cards;
      }
    }

    // loss minimization: escaping the 2x/3x multiplier zone is worth
    // shedding cards aggressively for, same urgency as an actual endgame
    if (myMultiplierZone > 1 || myCount <= 6) {
      // endgame — shed as many cards as possible per play to finish fast
      const multi = [...valid.filter(p => p.cards.length >= 2)]
        .sort((a, b) => b.cards.length - a.cards.length || a.combo.power[a.combo.power.length - 1] - b.combo.power[b.combo.power.length - 1]);
      if (multi.length) return multi[0].cards;

      // no multi-card combo left — choosing among singles. If a victim
      // exists and I'll still have cards left after this play, lead my
      // STRONGEST single that nobody can beat, instead of my weakest.
      // A weak lead here is a free invitation for a victim to legally
      // dump their own 2 or Ace; an unbeatable lead denies them that
      // chance entirely and saves my genuinely weak cards for the very
      // last play, when the round ends before they get a turn to matter.
      const singles = valid.filter(p => p.cards.length === 1);
      if (victimSeats.length > 0 && myCount > 1 && singles.length > 1) {
        const safe = sortByCheapest(singles).filter(s => !others.some(o => opponentCanBeat(o, s.combo, s.cards)));
        if (safe.length) {
          const strongest = safe.sort((a, b) => b.combo.power[1] - a.combo.power[1])[0];
          return strongest.cards;
        }
      }
      if (singles.length) return singles[0].cards;
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

  // 2) strategic pass: the current leader is about to win. Let them finish
  //    right now instead of extending the trick, when either:
  //    a) some OTHER opponent (not the leader, not me) is already stuck
  //       with a lot of cards — locks in their bad position, or
  //    b) I clearly can't win this round myself (I have more cards than
  //       everyone else) and there's no more multiplier value left to
  //       fight for, and the leader is the seat right before me in turn
  //       order — letting them win means I act early (right after the
  //       lead) next round instead of last, a real positional edge
  if (ownerDangerous && myCount > 3) {
    const otherVictims = victimSeats.filter(s => s !== ownerSeat);
    const leaderIsRightBeforeMe = (seat - 1 + 4) % 4 === ownerSeat;
    const clearlyCantWin = others.every(s => counts[s] < myCount);
    if (otherVictims.length > 0 || (leaderIsRightBeforeMe && clearlyCantWin && victimSeats.length === 0)) {
      return null;
    }
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
    const trimmedName = (name || "").trim();
    let seat = room.players.findIndex((p, i) => !room.isBot[i] && p === trimmedName);
    if (seat === -1) {
      seat = room.isBot.findIndex(b => b === true);
      if (seat === -1) return cb({ ok: false, error: "ห้องเต็มแล้ว" });
      room.players[seat] = trimmedName;
      room.isBot[seat] = false;
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
    const msg = { seat, name: room.players[seat], text: trimmed, at: Date.now() };
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
    for (const room of rooms.values()) {
      const seat = seatOf(room, socket.id);
      if (seat !== -1) room.socketIds[seat] = null; // seat stays reserved by name; bot fills turns meanwhile
      if (room.voiceSockets && room.voiceSockets.has(socket.id)) {
        room.voiceSockets.delete(socket.id);
        room.voiceSockets.forEach(id => io.sockets.sockets.get(id)?.emit("voicePeerLeft", { id: socket.id }));
      }
    }
  });
});

server.listen(PORT, () => console.log(`Big2 server running on port ${PORT}`));
