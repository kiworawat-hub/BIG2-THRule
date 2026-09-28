/* Integration test: starts a real server, connects real socket clients.
 *
 *   1. a cheating client cannot play cards it does not hold
 *   2. an honest client can still complete a whole round
 *
 * The second half is what would catch handContainsAll being over-tightened.
 * Takes ~1 minute because the bots deliberately pause 1.2s per move.
 * Run:  npm run test:server
 */
const { spawn } = require("child_process");
const path = require("path");
const { io } = require("socket.io-client");
const G = require("./gameLogic");

const PORT = 3211;
const URL = "http://localhost:" + PORT;
const key = (c) => c.rank + c.suit;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

function subsets(arr, k) {
  const out = [], idx = [];
  (function rec(start) {
    if (idx.length === k) { out.push(idx.map(i => arr[i])); return; }
    for (let i = start; i < arr.length; i++) { idx.push(i); rec(i + 1); idx.pop(); }
  })(0);
  return out;
}

const ROOM_TTL_MS = 3000; // the server's normal 30 min, shrunk so the test can watch it expire
const ROUND_RESULT_DELAY_WAIT = 6000; // the server waits 4s on the result screen before advancing
// a timed match counts in "minutes"; here a minute lasts a second, so a
// 1-minute match runs out during the first round instead of an hour later
const MATCH_MINUTE_MS = 1000;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
      env: { ...process.env, PORT: String(PORT), BIG2_ROOM_TTL_MS: String(ROOM_TTL_MS),
             BIG2_MATCH_TIME_UNIT_MS: String(MATCH_MINUTE_MS) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout.on("data", (d) => { if (String(d).includes("running")) resolve(proc); });
    proc.stderr.on("data", (d) => reject(new Error(String(d))));
    setTimeout(() => reject(new Error("server did not start")), 10000);
  });
}

// --- 1. the cheat must be refused -------------------------------------------
function cheatTest() {
  return new Promise((resolve) => {
    const sock = io(URL);
    let code = null, tried = false, refused = false, landed = false;
    const finish = () => { sock.close(); resolve({ tried, refused, landed }); };

    sock.on("connect", () => sock.emit("createRoom", { name: "Cheater" }, (r) => {
      code = r.code;
      sock.emit("startGame", { code });
    }));
    sock.on("actionError", () => { refused = true; });
    sock.on("state", (s) => {
      if (tried || s.phase !== "playing" || s.turn !== s.mySeat) return;
      const mine = new Set(s.myHand.map(key));
      const stolen = G.makeDeck().filter(c => !mine.has(key(c)))
        .sort((a, b) => G.cardValue(b) - G.cardValue(a))[0];
      // Match whatever size the trick demands, using copies of one card we do
      // not own. Size 1 tests pure ownership; sizes 2+ also test the duplicate
      // trick. Always firing on the first turn keeps the test off the 45s
      // turn-timeout, which is longer than this test's budget.
      const leading = s.lastPlayerSeat === null;
      const open = leading ? 2 : s.trickPile.slice(-1)[0].cards.length;
      const fake = Array(open).fill(stolen);
      tried = true;
      sock.emit("playCards", { code, cards: fake });
      setTimeout(() => {
        const t = s.trickPile.length ? s.trickPile.slice(-1)[0] : null;
        landed = !!(t && t.seat === s.mySeat && t.cards.some(x => key(x) === key(stolen)));
        finish();
      }, 900);
    });
    setTimeout(finish, 40000);
  });
}

// --- 2. honest play must still work -----------------------------------------
function honestTest(matchLimit) {
  return new Promise((resolve) => {
    const sock = io(URL);
    let code = null, plays = 0, rejects = 0, done = false, endPhase = null;
    // the history moved out of the state broadcast and behind getHistory
    let stateCarriedHistory = false, midRound = null, afterRound = null, asked = false;
    let deadlineSeen = false, last = null; // for the timed-match run
    const finish = (completed) => {
      if (done) return;
      done = true;
      sock.close();
      resolve({ plays, rejects, completed, endPhase, stateCarriedHistory, midRound, afterRound,
                deadlineSeen, last });
    };

    sock.on("connect", () => sock.emit("createRoom", { name: "Honest" }, (r) => {
      code = r.code;
      if (matchLimit) sock.emit("setMatchLimit", { code, ...matchLimit });
      sock.emit("startGame", { code });
    }));
    sock.on("actionError", () => { rejects++; });
    sock.on("state", (s) => {
      if ("roundHistory" in s) stateCarriedHistory = true;
      last = s;
      if (s.matchDeadline) deadlineSeen = true;
      if (s.phase === "gameover") { endPhase = "gameover"; return finish(true); }
      if (s.phase === "finished") {
        endPhase = "finished";
        sock.emit("getHistory", {}, (h) => {
          afterRound = h;
          if (!matchLimit) finish(true);
        });
        // with a match limit set, wait a moment to see if it flips to gameover
        if (matchLimit) setTimeout(() => finish(true), ROUND_RESULT_DELAY_WAIT);
        return;
      }
      if (s.phase !== "playing" || s.turn !== s.mySeat) return;
      // mid-round: the round being played must not be in the history yet
      if (!asked) { asked = true; sock.emit("getHistory", {}, (h) => { midRound = h; }); }

      const leading = s.lastPlayerSeat === null;
      const prevCards = leading ? null : s.trickPile.slice(-1)[0].cards;
      const prevCombo = prevCards ? G.classifyCombo(prevCards) : null;
      const sizes = leading
        ? [1, 2, 3, 4, 5]
        : [prevCards.length, prevCards.length === 1 ? 3 : prevCards.length === 2 ? 4 : 0];

      const legal = [];
      for (const n of sizes.filter(Boolean)) {
        for (const cand of subsets(s.myHand, n)) {
          const combo = G.classifyCombo(cand);
          if (combo && G.comboBeats(combo, prevCombo, cand, prevCards || [])) legal.push(cand);
        }
      }

      // House rule: if the seat NEXT TO US is down to one card and we choose
      // to play a SINGLE, it has to be our highest card. Playing a bigger
      // shape instead is unrestricted. "Next to us" is the next chair: whether
      // that player has passed this trick, or owns it, makes no difference.
      const nextSeat = G.nextSeatAfter(s.finished, s.mySeat);
      const nextIsOnOne = nextSeat !== s.mySeat && s.handCounts[nextSeat] === 1;

      let move = legal[0] || null;
      if (nextIsOnOne && move && move.length === 1) {
        const highest = s.myHand.reduce((b, c) => (G.cardValue(c) > G.cardValue(b) ? c : b), s.myHand[0]);
        const highestLegal = G.comboBeats(G.classifyCombo([highest]), prevCombo, [highest], prevCards || []);
        move = highestLegal ? [highest] : (legal.find(m => m.length > 1) || null);
      }
      if (move) { plays++; sock.emit("playCards", { code, cards: move }); }
      else sock.emit("pass", { code });
    });
    setTimeout(() => finish(false), 180000);
  });
}

// --- 3. abandoned rooms are freed, but reconnect still works ----------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// a real browser keeps its seat token in localStorage and sends it back
const tryJoin = (name, code, token) => new Promise((resolve) => {
  const s = io(URL);
  s.on("connect", () => s.emit("joinRoom", { name, code, token }, (res) => { s.close(); resolve(res); }));
  setTimeout(() => { s.close(); resolve({ ok: false, error: "timeout" }); }, 5000);
});

function makeRoom(name) {
  return new Promise((resolve) => {
    const s = io(URL);
    s.on("connect", () => s.emit("createRoom", { name }, (r) =>
      resolve({ sock: s, code: r.code, token: r.token })));
  });
}

async function cleanupTest() {
  // a) rejoining inside the window keeps the room alive
  const a = await makeRoom("Pok");
  a.sock.close();
  await sleep(ROOM_TTL_MS / 3);
  const early = await tryJoin("Pok", a.code, a.token);

  // b) leaving it abandoned past the window frees it
  const b = await makeRoom("Pok");
  b.sock.close();
  await sleep(ROOM_TTL_MS + 1500);
  const late = await tryJoin("Pok", b.code, b.token);

  return { early, late };
}

// --- 4. only the host can drive the match -----------------------------------
async function hostTest() {
  const host = await makeRoom("Host");
  const guest = io(URL);
  // Listening starts BEFORE joining: the state that answers the join can land
  // before a listener added afterwards, and the test then saw no state at all
  // (about one run in five) and read that as "not waiting".
  let guestPhase = null;
  guest.on("state", (s) => { guestPhase = s.phase; });
  await new Promise((r) => guest.on("connect", () => guest.emit("joinRoom",
    { name: "Guest", code: host.code }, () => r())));

  // guest (seat 1) tries to start; the host sits in seat 0 and is connected.
  // What the guest's table says once things have settled is the answer.
  const phaseAfter = () => new Promise((resolve) => setTimeout(() => resolve(guestPhase), 1200));

  guest.emit("startGame", { code: host.code });
  const afterGuest = await phaseAfter();

  host.sock.emit("startGame", { code: host.code });
  const afterHost = await phaseAfter();

  guest.close(); host.sock.close();
  return { afterGuest, afterHost };
}

// --- 5. joining during the seat draw must not erase the joiner --------------
async function seatDrawJoinTest() {
  const host = await makeRoom("Host");
  let players = null, phase = null;
  host.sock.on("state", (s) => { players = s.players; phase = s.phase; });

  host.sock.emit("startGame", { code: host.code }); // begins the ~2s seat draw
  await new Promise(r => setTimeout(r, 400));
  const joinedDuringDraw = phase === "seatdraw";

  const guest = io(URL);
  let guestPhase = null, guestUpdates = 0;
  guest.on("state", (s) => { guestUpdates++; guestPhase = s.phase; });
  await new Promise((res) => guest.on("connect", () =>
    guest.emit("joinRoom", { name: "Guest", code: host.code }, res)));

  await new Promise(r => setTimeout(r, 4000)); // let the draw finish
  const result = {
    joinedDuringDraw,
    stillSeated: (players || []).includes("Guest"),
    stillLive: guestPhase === "playing" && guestUpdates > 1,
  };
  guest.close(); host.sock.close();
  return result;
}

// --- 6. pause stops the clock; first play of a round gets longer ------------
async function pauseTest() {
  const host = await makeRoom("Host");
  let st = null, openingSeconds = null;
  host.sock.on("state", (s) => {
    st = s;
    // sample the clock at the one moment that matters: round dealt, nobody has
    // played yet. Sampling later catches a bot that has already opened.
    if (openingSeconds === null && s.phase === "playing" && !s.everPlayed) openingSeconds = s.turnSeconds;
  });
  let rejected = null;
  host.sock.on("actionError", (m) => { rejected = m; });

  host.sock.emit("startGame", { code: host.code });
  await new Promise(r => setTimeout(r, 3500)); // seat draw, then the deal

  host.sock.emit("pauseGame", { code: host.code });
  await new Promise(r => setTimeout(r, 500));
  const pausedBy = st && st.paused && st.paused.by;

  // playing while paused must be refused, whoever's turn it is
  host.sock.emit("playCards", { code: host.code, cards: (st.myHand || []).slice(0, 1) });
  await new Promise(r => setTimeout(r, 500));
  const refusedWhilePaused = rejected;

  host.sock.emit("resumeGame", { code: host.code });
  await new Promise(r => setTimeout(r, 500));
  const clearedAfterResume = st && st.paused === null;

  host.sock.close();
  return { openingSeconds, pausedBy, refusedWhilePaused, clearedAfterResume };
}

// --- 7. brute-forcing room codes gets throttled -----------------------------
async function rateLimitTest() {
  const sock = io(URL);
  await new Promise((r) => sock.on("connect", r));
  let answered = 0;
  const ATTEMPTS = 40; // the limit is 10 joins a minute
  await Promise.all(Array.from({ length: ATTEMPTS }, (_, i) =>
    new Promise((resolve) => {
      sock.emit("joinRoom", { name: "Bot" + i, code: "ZZZ" + i }, () => { answered++; resolve(); });
      setTimeout(resolve, 1500); // no answer = the packet was dropped
    })));
  // a normal player is unaffected: a fresh connection still works
  const fresh = await makeRoom("Normal");
  const freshOk = !!fresh.code;
  sock.close(); fresh.sock.close();
  return { attempts: ATTEMPTS, answered, freshOk };
}

// --- 8. the opener holds 3♣ but may lead anything ---------------------------
// Needs a deal where we are the opener, so it retries until dealt the 3♣.
async function openerTest(maxAttempts) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const host = await makeRoom("Opener");
    const result = await new Promise((resolve) => {
      let settled = false, code = host.code, rejected = null;
      host.sock.on("actionError", (m) => { rejected = m; });
      host.sock.emit("startGame", { code });
      host.sock.on("state", (s) => {
        if (settled || s.phase !== "playing" || s.everPlayed) return;
        if (s.turn !== s.mySeat) return;               // a bot opens; try again
        const three = s.myHand.find((c) => key(c) === "3♣");
        if (!three) return;                             // not the opener
        settled = true;
        // deliberately lead a single that is NOT the 3♣
        const other = s.myHand.filter((c) => key(c) !== "3♣")
          .sort((a, b) => G.cardValue(a) - G.cardValue(b))[0];
        const before = s.myHand.length;
        host.sock.emit("playCards", { code, cards: [other] });
        setTimeout(() => resolve({ opened: true, card: key(other), rejected, before }), 900);
      });
      setTimeout(() => { if (!settled) resolve({ opened: false }); }, 9000);
    });
    if (result.opened) {
      const after = await new Promise((r) => {
        const h = (s) => { host.sock.off("state", h); r(s); };
        host.sock.on("state", h);
        setTimeout(() => r(null), 1500);
      });
      host.sock.close();
      return { ...result, attempts: attempt + 1 };
    }
    host.sock.close();
  }
  return { opened: false };
}

// --- 9. a seat is guarded for as long as someone is sitting in it -----------
// The token stops a stranger sitting down on a player who is playing. It is
// deliberately NOT asked for once that connection is gone: the token lives in
// one browser's storage, and a dropped player often comes back from another
// one — guarding an empty seat harder than that only locks out its owner.
const joinWith = (name, code, token) => new Promise((resolve) => {
  const s = io(URL);
  s.on("connect", () => s.emit("joinRoom", { name, code, token }, (res) => { s.close(); resolve(res); }));
  setTimeout(() => { s.close(); resolve({ ok: false, error: "timeout" }); }, 5000);
});

// same, but the socket stays open — the player is still sitting there
const joinAndStay = (name, code, token) => new Promise((resolve) => {
  const s = io(URL);
  s.on("connect", () => s.emit("joinRoom", { name, code, token }, (res) => resolve({ sock: s, res })));
  setTimeout(() => { s.close(); resolve({ sock: s, res: { ok: false, error: "timeout" } }); }, 5000);
});

async function seatTokenTest() {
  const host = await makeRoom("Pok");
  // a real second player joins and stays connected
  const ann = await joinAndStay("Ann", host.code);
  const impostor = await joinWith("Ann", host.code);                   // no token
  const wrongToken = await joinWith("Ann", host.code, "deadbeef");      // bogus token
  const realReturn = await joinWith("Ann", host.code, ann.res.token);   // Ann's own browser
  // ...now Ann's phone drops, and she comes back without the token
  ann.sock.close();
  await sleep(300);
  const backByName = await joinWith("Ann", host.code);
  host.sock.close();
  return {
    annGotToken: !!ann.res.token && ann.res.token.length >= 16,
    impostorBlocked: impostor.ok === false,
    wrongTokenBlocked: wrongToken.ok === false,
    realReturnWorks: realReturn.ok === true && realReturn.seat === ann.res.seat,
    backByNameWorks: backByName.ok === true && backByName.seat === ann.res.seat,
    backByNameKeepsToken: backByName.token === ann.res.token,
    freshNameStillWorks: (await joinWith("Bee", host.code)).ok === true,
  };
}

// --- 8. coming back to a full room ------------------------------------------
// The reported bug: a phone keyboard capitalises the name on the way back in,
// the server sees a stranger, every seat is held, and it answers "ห้องเต็มแล้ว"
// while the player's own seat is sitting there empty.
async function reconnectTest() {
  const fill = async () => {
    const host = await make4("pok");
    return host;
  };
  const host = await fill();
  host.sock.close(); // the phone sleeps, the tab is closed
  await sleep(300);
  const capsWithToken = await joinWith("Pok", host.code, host.token);

  // the same drop, but from a browser that never had the token: a different
  // browser, an in-app one, or storage that was cleared in between
  const host2 = await fill();
  host2.sock.close();
  await sleep(300);
  const capsNoToken = await joinWith("Pok", host2.code);

  const host3 = await fill();
  const impostor = await joinWith("POK", host3.code); // still seated, no token

  // ...and a genuine stranger, with every seat spoken for, is told which of
  // them are sitting empty so a dropped player knows what name to type
  const stranger = await joinWith("Somebody Else", host3.code);
  host3.sock.close();

  return { capsWithToken, capsNoToken, impostor, stranger };
}

// --- 8b. leaving on purpose actually gives the seat up ----------------------
// Dropping keeps the seat reserved so the player can come back to their hand.
// Pressing "ออกจากห้อง" must not: the seat would go on holding their name and
// answer "ห้องเต็มแล้ว" to everyone, themselves included.
async function leaveRoomTest() {
  const host = await make4("pok"); // seat 0 is pok, and pok is still connected
  const stranger = await joinWith("Newcomer", host.code);
  await new Promise((r) => host.sock.emit("leaveRoom", {}, r));
  await sleep(300);
  const after = await joinAndStay("Newcomer", host.code);
  const seatIsFree = after.res.ok === true && after.res.seat === 0;
  const nameIsGone = !(await askList()).rooms.some(r => (r.players || []).includes("pok"));
  after.sock.close();
  host.sock.close();
  return { blockedWhileSeated: stranger.ok === false, seatIsFree, nameIsGone };
}

// a room with all four seats taken, the first one held by `name`
async function make4(name) {
  const host = await makeRoom(name);
  await joinWith("bee", host.code);
  await joinWith("cat", host.code);
  await joinWith("dog", host.code);
  return host;
}

// --- 9. the lobby sign board ------------------------------------------------
// It must show who is playing without handing out anything that lets a
// stranger get in: no room code, no cards, no chat.
const askList = () => new Promise((resolve) => {
  const s = io(URL);
  s.on("connect", () => s.emit("listRooms", {}, (res) => { s.close(); resolve(res); }));
  setTimeout(() => { s.close(); resolve({ ok: false, rooms: [] }); }, 5000);
});

async function listRoomsTest() {
  const host = await makeRoom("Lobbyist");
  await joinWith("Ann", host.code);
  const live = await askList();
  const mine = (live.rooms || []).find(r => (r.players || []).includes("Lobbyist"));

  // a room whose players have all closed their tabs is still in memory for
  // EMPTY_ROOM_TTL_MS, but nobody is there — it must not be advertised
  const ghost = await makeRoom("Ghosty");
  ghost.sock.close();
  await sleep(500); // well inside the TTL, so only the filter can hide it
  const after = await askList();

  host.sock.close();
  return {
    listed: !!mine,
    names: mine ? mine.players : [],
    fields: mine ? Object.keys(mine).sort().join(",") : "",
    leaksCode: JSON.stringify(live.rooms || []).includes(host.code),
    ghostHidden: !(after.rooms || []).some(r => (r.players || []).includes("Ghosty")),
  };
}

// --- a break must not eat into a timed match --------------------------------
function timedPauseTest() {
  return new Promise((resolve) => {
    const sock = io(URL);
    let code = null, before = null, after = null, pausedIt = false, done = false;
    const finish = () => { if (done) return; done = true; sock.close(); resolve({ before, after }); };

    sock.on("connect", () => sock.emit("createRoom", { name: "Timer" }, (r) => {
      code = r.code;
      sock.emit("setMatchLimit", { code, type: "time", value: 10 });
      sock.emit("startGame", { code });
    }));
    sock.on("state", (s) => {
      if (!pausedIt && s.phase === "playing" && s.matchDeadline) {
        pausedIt = true;
        before = s.matchDeadline;
        sock.emit("pauseGame", { code });
        setTimeout(() => sock.emit("resumeGame", { code }), 2000);
        return;
      }
      if (pausedIt && after === null && !s.paused && s.matchDeadline && s.matchDeadline !== before) {
        after = s.matchDeadline;
        finish();
      }
    });
    setTimeout(finish, 20000);
  });
}

// --- watching a table without a seat ----------------------------------------
// The audience must see the game and nothing else: no hand, no room code (that
// would let them sit down), no way to drive the game, and no ability to keep an
// abandoned room alive.
const watch = (watchId) => new Promise((resolve) => {
  const s = io(URL);
  const states = [];
  s.on("state", (st) => states.push(st));
  s.on("chatMessage", (m) => states.chat = (states.chat || []).concat([m]));
  s.on("connect", () => s.emit("observeRoom", { watchId }, (res) => resolve({ sock: s, res, states })));
  setTimeout(() => resolve({ sock: s, res: { ok: false, error: "timeout" }, states }), 5000);
});

async function observeTest() {
  const host = await makeRoom("Watched");
  const hostStates = [], hostChat = [];
  host.sock.on("state", (s) => hostStates.push(s));
  host.sock.on("chatMessage", (m) => hostChat.push(m));
  await joinWith("Ann", host.code); // a second seat, taken then abandoned

  const listed = ((await askList()).rooms || []).find(r => (r.players || []).includes("Watched"));
  const bogus = await watch("not-a-real-watch-id");
  bogus.sock.close();

  const eye = await watch(listed && listed.watchId);
  await sleep(300);
  const seen = eye.states[eye.states.length - 1] || {};
  const hostSaw = hostStates[hostStates.length - 1] || {};

  // none of these may do anything: the observer holds no seat
  eye.sock.emit("startGame", { code: host.code });
  eye.sock.emit("playCards", { code: host.code, cards: [{ rank: "3", suit: "♣" }] });
  await sleep(500);
  const stillWaiting = (eye.states[eye.states.length - 1] || {}).phase === "waiting";

  // a real message from a seated player: it has to reach the table and stop
  // there -- checking only that the observer is silent would pass even if the
  // chat never went anywhere
  host.sock.emit("chatMessage", { code: host.code, text: "หวัดดี" });
  await sleep(400);

  // the real host starts, and the audience follows along without seeing cards
  host.sock.emit("startGame", { code: host.code });
  await sleep(600);
  const afterStart = eye.states[eye.states.length - 1] || {};

  // the audience gets the history screen too -- finished rounds only, and it
  // needs no room code to ask for it
  const eyeHistory = await new Promise((r) => eye.sock.emit("getHistory", {}, r));

  eye.sock.close();
  await sleep(300);
  const countAfterLeaving = (hostStates[hostStates.length - 1] || {}).observers;

  // an observer alone in a room does not count as somebody being there
  const lonely = await watch(listed && listed.watchId);
  host.sock.close();
  await sleep(400);
  const ghost = ((await askList()).rooms || []).some(r => (r.players || []).includes("Watched"));
  lonely.sock.close();

  return {
    watchIdOffered: !!(listed && listed.watchId),
    bogusRefused: bogus.res.ok === false,
    accepted: eye.res.ok === true,
    seatIsMinusOne: seen.mySeat === -1,
    noHand: Array.isArray(seen.myHand) && seen.myHand.length === 0,
    noCode: seen.code === null && !JSON.stringify(seen).includes(host.code)
            && !JSON.stringify(eye.res).includes(host.code),
    sawPlayers: (seen.players || []).includes("Watched"),
    countedForPlayers: hostSaw.observers === 1,
    couldNotStart: stillWaiting,
    chatReachedTheTable: hostChat.length === 1,
    gotNoChat: !eye.states.chat,
    followsTheGame: afterStart.phase !== "waiting",
    stillNoHandInPlay: Array.isArray(afterStart.myHand) && afterStart.myHand.length === 0,
    handsStayHidden: afterStart.allHands === null,
    canAskForHistory: eyeHistory.ok === true && Array.isArray(eyeHistory.roundHistory),
    countedDownOnLeaving: countAfterLeaving === 0,
    ghostRoomHidden: !ghost,
  };
}

(async () => {
  const server = await startServer();
  try {
    console.log("\ncheating client");
    const cheat = await cheatTest();
    ok("the fake play was attempted", cheat.tried);
    ok("the server refused it", cheat.refused);
    ok("it never reached the table", !cheat.landed);

    console.log("\nhonest client");
    const honest = await honestTest();
    ok("the round played to completion", honest.completed);
    ok("legal moves were accepted", honest.plays > 0);
    ok("no legal move was refused", honest.rejects === 0);

    console.log("\nthe history of finished rounds");
    const hist = (honest.afterRound || {}).roundHistory || [];
    const dealt = (hist[0] || {}).startingHands;
    ok("the state broadcast no longer carries the history", !honest.stateCarriedHistory);
    ok("mid-round, the round being played is not in the history",
       ((honest.midRound || {}).roundHistory || []).length === 0);
    ok("once the round ends it is there", hist.length === 1);
    ok("with what all four players were dealt",
       Array.isArray(dealt) && dealt.length === 4 && dealt.every(h => h.length === 13));
    ok("a whole deck, no card dealt twice", (() => {
      if (!Array.isArray(dealt)) return false;
      const all = dealt.flat().map(key);
      return all.length === 52 && new Set(all).size === 52;
    })());
    ok("and the cards each player was left holding, as before",
       Array.isArray((hist[0] || {}).hands));

    console.log("\nabandoned room cleanup");
    const clean = await cleanupTest();
    ok("reconnecting inside the window still works", clean.early.ok === true);
    ok("an abandoned room is freed after the window", clean.late.ok === false);
    ok("and rejoining it says the room is gone", /ไม่พบห้องนี้/.test(clean.late.error || ""));

    console.log("\nhost-only match controls");
    const host = await hostTest();
    ok("a non-host cannot start the game", host.afterGuest === "waiting");
    ok("the host can", host.afterHost !== "waiting");

    console.log("\njoining during the seat draw");
    const race = await seatDrawJoinTest();
    ok("the join really did land mid-draw", race.joinedDuringDraw);
    ok("the joiner is still seated afterwards", race.stillSeated);
    ok("and their client keeps receiving state", race.stillLive);

    console.log("\npause and the opening-play clock");
    const p = await pauseTest();
    ok("the first play of a round gets 60s, not 45s", p.openingSeconds === 60);
    ok("pausing records who called the break", p.pausedBy === "Host");
    ok("playing while paused is refused", /พัก/.test(p.refusedWhilePaused || ""));
    ok("resuming clears the pause", p.clearedAfterResume === true);

    console.log("\nmatch ends at a points limit");
    // 1 point is unreachably low, so the very first round must end the match
    const limited = await honestTest({ type: "points", value: 1 });
    ok("the round still played out", limited.plays > 0);
    ok("the match ended instead of dealing again", limited.endPhase === "gameover");

    console.log("\na match that ends on the clock");
    // one "minute" is a second here, so the hour runs out during round 1
    const timed = await honestTest({ type: "time", value: 1 });
    ok("kickoff arms a deadline", timed.deadlineSeen);
    ok("the round in progress was allowed to finish", timed.plays > 0);
    ok("running out of time does not cut the match off there and then",
       (timed.last || {}).phase !== "gameover");
    ok("it starts the last-4-rounds countdown instead",
       (timed.last || {}).matchRoundsRemaining === 4);
    ok("and the clock is put away once it has fired", (timed.last || {}).matchDeadline === null);

    const tp = await timedPauseTest();
    ok("a break pushes the deadline back by however long it lasted (" +
       Math.round(((tp.after || 0) - (tp.before || 0)) / 100) / 10 + "s)",
       tp.before !== null && tp.after !== null && tp.after - tp.before >= 1800);

    console.log("\nroom-code brute force is throttled");
    const rl = await rateLimitTest();
    ok("most of the 40 rapid join attempts were dropped (" + rl.answered + " answered)", rl.answered <= 12);
    ok("at least the allowed ones went through", rl.answered > 0);
    ok("a normal player on a fresh connection is unaffected", rl.freshOk);

    console.log("\nthe opener may lead anything, not just the 3♣");
    const op = await openerTest(12);
    ok("got a deal where we hold the 3♣ (attempt " + (op.attempts || "-") + ")", op.opened === true);
    ok("leading " + (op.card || "?") + " instead of 3♣ was accepted", op.opened && !op.rejected);

    console.log("\na seat is guarded while its player is connected");
    const st = await seatTokenTest();
    ok("a joining player is issued a seat token", st.annGotToken);
    ok("someone typing that name without the token is refused", st.impostorBlocked);
    ok("a made-up token is refused", st.wrongTokenBlocked);
    ok("the real player still gets their own seat back", st.realReturnWorks);
    ok("once she has dropped, her own name gets the seat back without the token",
       st.backByNameWorks);
    ok("and the token is not rotated, so her other browser still works",
       st.backByNameKeepsToken);
    ok("a new player with a fresh name can still join", st.freshNameStillWorks);

    console.log("\ncoming back to a full room");
    const rc = await reconnectTest();
    ok("a capitalised name with the seat token gets the seat back", rc.capsWithToken.ok === true);
    ok("and it is the same seat, not a new one", rc.capsWithToken.seat === 0);
    ok("a browser without the token gets the empty seat back on the name alone",
       rc.capsNoToken.ok === true && rc.capsNoToken.seat === 0);
    ok("nobody is told the room is full while their own seat waits",
       !/เต็ม/.test(rc.capsNoToken.error || ""));
    ok("a stranger typing the name in caps still cannot take a seat in use",
       rc.impostor.ok === false);
    ok("a full room turns a stranger away", rc.stranger.ok === false);
    ok("and names the seats nobody is connected to (" + (rc.stranger.error || "") + ")",
       /เต็ม/.test(rc.stranger.error || "") && /bee/.test(rc.stranger.error || ""));

    console.log("\nleaving the room on purpose");
    const lv = await leaveRoomTest();
    ok("a full room turns a newcomer away to begin with", lv.blockedWhileSeated);
    ok("the seat is free the moment its player leaves", lv.seatIsFree);
    ok("and the room stops showing their name", lv.nameIsGone);

    console.log("\nthe lobby sign board");
    const lob = await listRoomsTest();
    ok("a room being played is listed", lob.listed);
    ok("it names the players (" + lob.names.filter(Boolean).join(", ") + ")",
       lob.names.includes("Lobbyist") && lob.names.includes("Ann"));
    ok("it sends nothing but names, phase, round and how to watch (" + lob.fields + ")",
       lob.fields === "observers,phase,players,round,watchId");
    ok("it never hands out the room code", !lob.leaksCode);
    ok("an abandoned room is not advertised", lob.ghostHidden);

    console.log("\nwatching a table without a seat");
    const obs = await observeTest();
    ok("the board offers a way to watch", obs.watchIdOffered);
    ok("a made-up watch id is refused", obs.bogusRefused);
    ok("watching is accepted", obs.accepted);
    ok("the observer has no seat", obs.seatIsMinusOne);
    ok("the observer gets no hand", obs.noHand);
    ok("the observer is never told the room code", obs.noCode);
    ok("the observer sees who is playing", obs.sawPlayers);
    ok("the players are told someone is watching", obs.countedForPlayers);
    ok("an observer cannot start the game", obs.couldNotStart);
    ok("the players' own chat still reaches the table", obs.chatReachedTheTable);
    ok("but it does not reach the observer", obs.gotNoChat);
    ok("the observer follows the game once it starts", obs.followsTheGame);
    ok("and still sees no cards during play", obs.stillNoHandInPlay && obs.handsStayHidden);
    ok("an observer can open the history screen too", obs.canAskForHistory);
    ok("the count drops when they stop watching", obs.countedDownOnLeaving);
    ok("an observer alone does not keep an abandoned room advertised", obs.ghostRoomHidden);
  } finally {
    server.kill();
  }
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
