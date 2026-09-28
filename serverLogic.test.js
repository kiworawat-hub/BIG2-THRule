/* In-process tests for server rules that a random deal cannot be made to reach:
 * who is asked about a reseat and in what order, when the server passes for a
 * player, and the list of plays behind tapping the table.
 *
 * server.test.js starts a real server and plays real rounds, which is slow
 * (bots pause 1.2s per move) and cannot choose the deal. This one requires
 * server.js as a module, builds the exact room it wants, and drives it.
 *
 * Run:  npm run test:logic
 */
process.env.BIG2_SEAT_PROMPT_MS = "400"; // the real 10s, shrunk so a timeout can be watched
process.env.BIG2_AUTO_PASS_MS = "60";     // the real 0.8s

const { io: connect } = require("socket.io-client");
const S = require("./server");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = (rank, suit) => ({ rank, suit });
const H = (...specs) => specs.map((s) => c(s.slice(0, -1), s.slice(-1)));
const RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const SUITS = ["♣", "♦", "♥", "♠"];
// n distinct cards -- only the count matters to the rules under test
const cards = (n) => Array.from({ length: n }, (_, i) => c(RANKS[i % 13], SUITS[Math.floor(i / 13)]));

let codeCounter = 0;
// A room with four real, connected players (so nobody is a bot and every seat
// can be asked questions). `code` is unique because rooms live in one shared map.
function makeRoom(over) {
  const room = S.newRoomState("A", "s0");
  room.code = "T" + String(++codeCounter).padStart(3, "0");
  room.players = ["A", "B", "C", "D"];
  room.socketIds = ["s0", "s1", "s2", "s3"];
  room.seatTokens = ["t0", "t1", "t2", "t3"];
  Object.assign(room, over || {});
  S.rooms.set(room.code, room);
  return room;
}

// A round that has just ended: the winner holds nothing, the rest hold `left`.
function finishedRoom(winner, left, over) {
  const room = makeRoom(Object.assign({ round: 3 }, over || {}));
  room.hands = [0, 1, 2, 3].map((s) => (s === winner ? [] : cards(left[s] === undefined ? 4 : left[s])));
  room.finished = [winner];
  room.phase = "finished";
  room.lastMultiplierVictims = [0, 1, 2, 3].filter((s) => room.hands[s].length >= 10);
  return room;
}

(async () => {
  // ------------------------------------------------------------------
  console.log("\nthe plays of the round in progress");
  {
    const room = makeRoom();
    S.startRound(room, 0);
    room.hands = [H("3♣", "9♦"), H("5♦", "6♦", "J♦"), H("7♦", "8♦"), H("9♣", "10♣")];
    S.applyPlay(room, 0, H("3♣"));            // 1: opens the trick
    S.applyPlay(room, 1, H("5♦"));            // 2: answers it
    S.applyPass(room, 2); S.applyPass(room, 3); S.applyPass(room, 0);
    // everyone else passed on seat 1's card, so the trick is over and seat 1 leads
    ok("the trick reset and seat 1 leads again", room.lastPlayerSeat === null && room.turn === 1);
    S.applyPlay(room, 1, H("6♦"));            // 3: opens the next trick

    const p = room.roundPlays;
    ok("three plays were recorded", p.length === 3);
    ok("numbered 1, 2, 3 in the order they happened", p.map((x) => x.n).join(",") === "1,2,3");
    ok("with who played each", p.map((x) => x.seat).join(",") === "0,1,1");
    ok("and what they played", p[0].cards[0].rank === "3" && p[1].cards[0].rank === "5" && p[2].cards[0].rank === "6");
    ok("marking the plays that opened a trick", p.map((x) => x.lead).join(",") === "true,false,true");
    ok("passes are not plays", p.length === 3);
    ok("the state broadcast carries only the count", S.sanitizeForSeat(room, 0).playsCount === 3 &&
       !("roundPlays" in S.sanitizeForSeat(room, 0)));

    room.hands[1] = [];
    S.finishRound(room, 1);
    ok("once the round ends, its plays are gone", room.roundPlays.length === 0);
    ok("and the count says so", S.sanitizeForSeat(room, 0).playsCount === 0);
    S.startRound(room, 1);
    ok("a new round starts from an empty list", room.roundPlays.length === 0);
  }

  // ------------------------------------------------------------------
  console.log("\nthe server passes for a seat that cannot answer");
  {
    const setup = (myHand, onTable, over) => {
      const room = makeRoom();
      S.startRound(room, 0);
      room.hands = [cards(5), myHand, cards(5), cards(5)];
      room.everPlayed = true;
      room.lastPlay = { cards: onTable, seat: 0 };
      room.lastPlayerSeat = 0;
      room.trickPile = [{ cards: onTable, seat: 0 }];
      room.passedThisTrick = [];
      room.turn = 1;
      Object.assign(room, over || {});
      return room;
    };
    const pair = H("8♣", "8♦"), five = H("3♣", "4♦", "5♥", "6♠", "7♣"), single = H("8♣");

    ok("one card left facing a pair: pass",  S.pendingAutoPassSeat(setup(cards(1), pair)) === 1);
    ok("two cards left facing a pair: no (a higher pair is possible)", S.pendingAutoPassSeat(setup(cards(2), pair)) === null);
    ok("four cards left facing a 5-card set: pass", S.pendingAutoPassSeat(setup(cards(4), five)) === 1);
    ok("five cards left facing a 5-card set: no", S.pendingAutoPassSeat(setup(cards(5), five)) === null);
    ok("two cards left facing a triple: pass", S.pendingAutoPassSeat(setup(cards(2), H("9♣", "9♦", "9♥"))) === 1);
    ok("three cards left facing a quad: pass", S.pendingAutoPassSeat(setup(cards(3), H("9♣", "9♦", "9♥", "9♠"))) === 1);
    ok("one card left facing a single: no (it can still be beaten)", S.pendingAutoPassSeat(setup(cards(1), single)) === null);

    const leading = setup(cards(1), pair, { lastPlayerSeat: null, lastPlay: null, trickPile: [] });
    ok("leading a fresh trick: never (you have to play)", S.pendingAutoPassSeat(leading) === null);
    const bot = setup(cards(1), pair, { players: ["A", null, "C", "D"] });
    ok("a bot is never picked -- it passes on its own", S.pendingAutoPassSeat(bot) === null);
    const paused = setup(cards(1), pair, { paused: { by: "A", at: Date.now(), until: Date.now() + 1000 } });
    ok("nothing happens while the game is paused", S.pendingAutoPassSeat(paused) === null);

    const room = setup(cards(1), pair);
    ok("the seat is announced in the state, so the client can say why",
       S.sanitizeForSeat(room, 1).autoPassSeat === 1 && S.sanitizeForSeat(room, 2).autoPassSeat === 1);
    S.scheduleTurn(room);
    ok("nothing is passed instantly", room.turn === 1);
    await sleep(250);
    ok("after the beat the seat has passed", room.passedThisTrick.includes(1));
    ok("and the turn moved on", room.turn === 2);
    ok("it shows in the log like any pass", room.log.some((l) => l.includes("ผ่าน")));
  }

  // ------------------------------------------------------------------
  console.log("\nafter a round, the multiplied are asked about a reseat");
  {
    // winner seat 0 -> legs: seat 1 = leg 2, seat 2 = leg 3, seat 3 = leg 4
    let room = finishedRoom(0, { 1: 5, 2: 11, 3: 13 });
    ok("both 10+ card seats count as multiplied", room.lastMultiplierVictims.join(",") === "2,3");
    S.advanceAfterRound(room);
    ok("the LAST leg is asked first", room.seatPrompt && room.seatPrompt.seat === 3);
    ok("and told which leg they would be", room.seatPrompt.leg === 4);
    ok("the round has not been dealt yet", room.phase === "finished");
    ok("the state shows the question but not the queue behind it",
       S.sanitizeForSeat(room, 1).seatPrompt.seat === 3 && !("queue" in S.sanitizeForSeat(room, 1).seatPrompt));

    ok("somebody else answering does nothing", S.answerSeatPrompt(room, 2, true) === false && room.phase === "finished");
    ok("...and the question is still on seat 3", room.seatPrompt.seat === 3);

    S.answerSeatPrompt(room, 3, false);
    ok("a \"no\" moves on to the next leg up", room.seatPrompt && room.seatPrompt.seat === 2 && room.seatPrompt.leg === 3);
    S.answerSeatPrompt(room, 2, false);
    ok("with nobody left, the next round is dealt with the seats as they are",
       room.seatPrompt === null && room.phase === "playing" && room.round === 4);
    ok("and last round's winner leads", room.turn === 0);
    ok("nobody moved", room.players.join(",") === "A,B,C,D");
  }
  {
    let room = finishedRoom(0, { 1: 5, 2: 11, 3: 13 });
    S.advanceAfterRound(room);
    S.answerSeatPrompt(room, 3, true);
    ok("a \"yes\" goes straight to the seat draw", room.phase === "seatdraw" && room.seatPrompt === null);
    ok("the next round is the one being drawn for", room.seatDraw && room.seatDraw.pendingRound === 4);
    ok("the winner is remembered so they still lead", room.seatDraw.winnerOldSeat === 0);
    ok("and seat 2 was never asked", room.seatPrompt === null);
  }
  {
    // winner seat 2 -> seat 3 = leg 2, seat 0 = leg 3, seat 1 = leg 4
    let room = finishedRoom(2, { 0: 10, 1: 12, 3: 3 });
    S.advanceAfterRound(room);
    ok("legs are counted from the winner, not from seat 0", room.seatPrompt.seat === 1 && room.seatPrompt.leg === 4);
    S.answerSeatPrompt(room, 1, false);
    ok("then the next leg up (seat 0 is leg 3)", room.seatPrompt.seat === 0 && room.seatPrompt.leg === 3);
  }
  {
    let room = finishedRoom(0, { 1: 4, 2: 4, 3: 4 });
    S.advanceAfterRound(room);
    ok("nobody multiplied: nobody is asked, the next round just starts",
       room.seatPrompt === null && room.phase === "playing" && room.round === 4);
  }
  {
    let room = finishedRoom(0, { 1: 5, 2: 11, 3: 13 }, { players: ["A", "B", "C", null] });
    S.advanceAfterRound(room);
    ok("a multiplied BOT has nobody to ask -- the human on leg 3 is asked", room.seatPrompt && room.seatPrompt.seat === 2);
  }
  {
    let room = finishedRoom(0, { 1: 4, 2: 4, 3: 13 }, { players: ["A", "B", "C", null] });
    S.advanceAfterRound(room);
    ok("only a bot multiplied: nothing to ask, the round starts", room.seatPrompt === null && room.phase === "playing");
  }
  {
    let room = finishedRoom(0, { 1: 5, 2: 11, 3: 13 }, { socketIds: ["s0", "s1", "s2", null] });
    S.advanceAfterRound(room);
    ok("a player who has dropped is skipped, not waited for", room.seatPrompt && room.seatPrompt.seat === 2);
  }
  {
    let room = finishedRoom(0, { 1: 5, 2: 11, 3: 13 });
    S.advanceAfterRound(room);
    await sleep(550); // the seat-3 window (400ms) runs out, then seat 2 is asked
    ok("no answer in time counts as \"no\" and moves on", room.seatPrompt && room.seatPrompt.seat === 2);
    await sleep(550);
    ok("and when nobody answers at all the game carries on by itself",
       room.seatPrompt === null && room.phase === "playing" && room.round === 4);
  }
  {
    let room = finishedRoom(0, { 1: 5, 2: 11, 3: 13 });
    S.advanceAfterRound(room);
    // the asked player quits mid-question
    room.players[3] = null; room.socketIds[3] = null;
    S.answerSeatPrompt(room, 3, false);
    ok("if the player asked leaves, the question moves on", room.seatPrompt && room.seatPrompt.seat === 2);
  }
  {
    let room = finishedRoom(0, { 1: 5, 2: 11, 3: 13 }, { matchRoundsRemaining: 0 });
    S.advanceAfterRound(room);
    ok("when the match is over nobody is asked about a reseat", room.phase === "gameover" && room.seatPrompt === null);
  }

  // ------------------------------------------------------------------
  console.log("\nsoak: whole games without waiting on the clocks");
  {
    const G = require("./gameLogic");
    let games = 0, stuck = 0, broke = 0, forcedChecks = 0, lostCards = 0, playCountWrong = 0, threw = 0;
    for (let g = 0; g < 80; g++) {
      const room = makeRoom({ players: [null, null, null, null], socketIds: [null, null, null, null] });
      S.startRound(room, undefined);
      let steps = 0, plays = 0;
      try {
        while (room.phase === "playing" && room.turn !== null && steps < 1500) {
          steps++;
          const seat = room.turn;
          const state = { hands: room.hands, finished: room.finished, passedThisTrick: room.passedThisTrick,
                          lastPlayerSeat: room.lastPlayerSeat, lastPlay: room.lastPlay };
          const forced = G.getForcedHighCard(state, seat);
          const before = room.hands[seat].map((x) => x.rank + x.suit);
          const total = room.hands.reduce((n, h) => n + h.length, 0);
          // alternate between the bot's own choice and what a clock running out does
          if (steps % 5 === 0) S.autoTimeout(room); else S.botAct(room);
          const after = room.hands[seat].map((x) => x.rank + x.suit);
          const gone = before.filter((k) => !after.includes(k));
          if (gone.length) plays++;
          if (forced) {
            forcedChecks++;
            // The rule only binds a SINGLE: a pair / triple / 5-set is always allowed. So when it
            // applies they must not pass, and if they played one card it must be their highest.
            const passed = gone.length === 0;
            const lowerSingle = gone.length === 1 && gone[0] !== forced.rank + forced.suit;
            if (passed || lowerSingle) {
              broke++;
              if (broke <= 3) console.log("    broke the rule:", JSON.stringify({ seat, forced: forced.rank + forced.suit, gone, path: steps % 5 === 0 ? "autoTimeout" : "bot" }));
            }
          }
          if (room.hands.reduce((n, h) => n + h.length, 0) !== total - gone.length) lostCards++;
          if (room.turn === null) break; // the winning card is down; the round is over
        }
      } catch (e) { threw++; console.log("    threw:", e.message); }
      if (room.turn !== null) stuck++; else {
        games++;
        S.clearTimers(room);
        const winner = room.hands.findIndex((h) => h.length === 0);
        if (room.roundPlays.length !== plays) playCountWrong++;
        S.finishRound(room, winner);
        S.clearTimers(room);
      }
    }
    ok("80 all-bot rounds all finished", games === 80 && stuck === 0);
    ok("nothing threw", threw === 0);
    ok("the last-card rule came up often enough to mean something (" + forcedChecks + " times)", forcedChecks >= 40);
    ok("every time it did, the bot or the timeout obeyed it", broke === 0);
    ok("no card was ever lost or duplicated", lostCards === 0);
    ok("the plays list matched the plays made, every round", playCountWrong === 0);
  }

  // ------------------------------------------------------------------
  console.log("\nover a real socket");
  const PORT = 3212;
  await new Promise((r) => S.server.listen(PORT, r));
  const sock = connect("http://localhost:" + PORT);
  await new Promise((r) => sock.on("connect", r));
  let lastState = null;
  sock.on("state", (s) => { lastState = s; });
  const create = await new Promise((r) => sock.emit("createRoom", { name: "Host" }, r));
  const room = S.rooms.get(create.code);
  const ask = (ev, payload) => new Promise((r) => sock.emit(ev, payload, r));

  ok("no plays to list before the game starts", (await ask("getRoundPlays", {})).ok === false);

  room.players = ["Host", "B", "C", "D"];
  room.socketIds = [sock.id, "s1", "s2", "s3"];
  S.startRound(room, 0);
  room.hands = [H("3♣", "9♦"), H("5♦", "6♦"), H("7♦", "8♦"), H("9♣", "10♣")];
  S.applyPlay(room, 0, H("3♣"));
  S.applyPlay(room, 1, H("5♦"));
  const listed = await ask("getRoundPlays", {});
  ok("during the round the plays come back", listed.ok === true && listed.plays.length === 2);
  ok("in order, with who played what", listed.plays[0].seat === 0 && listed.plays[1].cards[0].rank === "5");

  room.hands[1] = [];
  S.finishRound(room, 1);
  const after = await ask("getRoundPlays", {});
  ok("after the round ends they can no longer be looked up", after.ok === false && after.plays.length === 0);

  // seat 0 (the socket) is multiplied on leg 3 of a round seat 2 won
  const sock2 = connect("http://localhost:" + PORT);
  await new Promise((r) => sock2.on("connect", r));
  let solo = null;
  sock2.on("state", (s) => { solo = s; });
  const create2 = await new Promise((r) => sock2.emit("createRoom", { name: "Solo" }, r));
  const room2 = S.rooms.get(create2.code);
  room2.players = ["Solo", "B", "C", "D"];
  room2.socketIds = [sock2.id, "s1", "s2", "s3"];
  room2.hands = [cards(11), cards(3), [], cards(2)];
  room2.finished = [2];
  room2.phase = "finished";
  room2.lastMultiplierVictims = [0];
  room2.round = 5;
  S.advanceAfterRound(room2);
  await sleep(120);
  ok("the multiplied player's client is told it is their question", solo && solo.seatPrompt && solo.seatPrompt.seat === 0);
  ok("with the leg they would get (winner is seat 2, so seat 0 is leg 3)", solo && solo.seatPrompt.leg === 3);
  sock2.emit("answerSeatDraw", { code: room2.code, choice: true });
  await sleep(120);
  ok("their \"yes\" started the seat draw", room2.phase === "seatdraw");
  ok("and the client sees it", solo && solo.phase === "seatdraw" && solo.seatPrompt === null);

  // anyone but the player being asked is ignored, even over the wire
  const room3 = makeRoom();
  room3.players = ["Solo", "B", "C", "D"];
  room3.hands = [[], cards(12), cards(3), cards(2)];
  room3.finished = [0];
  room3.phase = "finished";
  room3.lastMultiplierVictims = [1];
  room3.socketIds = ["s0", "s1", "s2", "s3"];
  room3.round = 1;
  S.advanceAfterRound(room3);
  room3.socketIds[2] = sock.id; // this socket now sits at seat 2, but seat 1 is the one being asked
  sock.emit("answerSeatDraw", { code: room3.code, choice: true });
  await sleep(120);
  ok("a \"yes\" from the wrong seat changes nothing", room3.phase === "finished" && room3.seatPrompt && room3.seatPrompt.seat === 1);

  // ------------------------------------------------------------------
  console.log("\nwho the host is");
  {
    // the match controls used to go to "the lowest-numbered occupied seat", so
    // the person holding them changed every time the seats were redrawn
    const room = makeRoom();
    room.hostToken = "H";
    room.players = ["Guest", "B", "Host", "D"];
    room.seatTokens = ["G", "b", "H", "d"];
    ok("the creator is the host wherever they end up sitting", S.isHost(room, 2) === true);
    ok("...and the player in the lowest seat is not, just for sitting there", S.isHost(room, 0) === false);
    ok("the state each player gets says so",
       S.sanitizeForSeat(room, 2).isHost === true && S.sanitizeForSeat(room, 0).isHost === false);
    ok("someone watching is never the host", S.isHost(room, -1) === false && S.sanitizeForSeat(room, -1).isHost === false);
    room.socketIds[2] = null;
    ok("a host who has dropped can be stood in for, so a closed tab cannot freeze the room", S.isHost(room, 0) === true);
    ok("...but not by a stranger", S.isHost(room, -1) === false);

    const legacy = makeRoom();
    legacy.hostToken = null;
    legacy.players = [null, "B", "C", null];
    legacy.seatTokens = [null, "b", "c", null];
    ok("with no host on record it falls back to the lowest occupied seat", S.isHost(legacy, 1) === true && S.isHost(legacy, 2) === false);
  }
  {
    const hostSock = connect("http://localhost:" + PORT);
    await new Promise((r) => hostSock.on("connect", r));
    let hostView = null; hostSock.on("state", (st) => { hostView = st; });
    const made = await new Promise((r) => hostSock.emit("createRoom", { name: "Maker" }, r));
    const guestSock = connect("http://localhost:" + PORT);
    await new Promise((r) => guestSock.on("connect", r));
    let guestView = null; guestSock.on("state", (st) => { guestView = st; });
    await new Promise((r) => guestSock.emit("joinRoom", { name: "Guest", code: made.code }, r));
    await sleep(100);
    const room = S.rooms.get(made.code);
    ok("whoever makes a room is its host", hostView && hostView.isHost === true);
    ok("a guest is not", guestView && guestView.isHost === false);

    // a reseat: the guest ends up in seat 0, the creator in seat 2
    const swap = (a, b) => { for (const k of ["players", "socketIds", "seatTokens"]) { const t = room[k][a]; room[k][a] = room[k][b]; room[k][b] = t; } };
    swap(0, 1); swap(1, 2); // seats were [Maker, Guest, -, -]; now [Guest, -, Maker, -]
    S.broadcastState(made.code);
    await sleep(100);
    ok("after a reseat the creator is STILL the host", hostView.isHost === true && hostView.mySeat === 2);
    ok("and the guest, now in the lowest seat, is still not", guestView.isHost === false);

    hostSock.emit("leaveRoom", {}, () => {});
    await sleep(150);
    ok("when the host leaves the table, the guest becomes host", guestView.isHost === true);
    swap(0, 3);
    S.broadcastState(made.code);
    await sleep(100);
    ok("and stays host through the next reseat too", guestView.isHost === true);
    hostSock.close(); guestSock.close();
  }

  sock.close(); sock2.close();

  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
