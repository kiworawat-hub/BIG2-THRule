/* Renders the real client.js in a fake browser (jsdom) and inspects the DOM.
 *
 * This is the test that was missing: every previous UI change had to be
 * checked by hand, which is how the control row shipped clipped off screen.
 * It cannot see layout, but it catches runtime errors, missing buttons, and
 * buttons that are wrongly disabled.
 *
 * Run:  npm run test:client
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

// --- a fake browser -------------------------------------------------------
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/", pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.localStorage = window.localStorage;
global.requestAnimationFrame = window.requestAnimationFrame;
global.HTMLElement = window.HTMLElement;

const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));

// React, as the page loads it from the CDN
global.React = window.React = require("react");
global.ReactDOM = window.ReactDOM = require("react-dom/client");

// --- a fake socket --------------------------------------------------------
// Records what the client emits and lets the test push server state back.
const sent = [];
const handlers = {};
let joinShouldFail = false; // flipped to simulate the room being gone
let roomsOnAir = [];        // what listRooms reports back to the lobby
// one finished round, shaped like the server's roundHistory entry
const RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const deal = (suit) => RANKS.map((rank) => ({ rank, suit }));
const historyRows = [{
  round: 4, net: [9, -3, -2, -4], scores: [0, 6, 4, 8], cardsLeft: [0, 6, 4, 8],
  players: ["Pok", "Ann", null, null],
  hands: [[], deal("♦").slice(0, 6), deal("♥").slice(0, 4), deal("♠").slice(0, 8)],
  startingHands: [deal("♣"), deal("♦"), deal("♥"), deal("♠")],
}];
const cc = (rank, suit) => ({ rank, suit });
const fakeSocket = {
  on: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
  off: () => {},
  emit: (ev, payload, cb) => {
    sent.push({ ev, payload });
    if (!cb) return;
    if (ev === "joinRoom" && joinShouldFail) cb({ ok: false, error: "ไม่พบห้องนี้" });
    else if (ev === "listRooms") cb({ ok: true, rooms: roomsOnAir });
    else if (ev === "getHistory") cb({ ok: true, roundHistory: historyRows });
    else cb({ ok: true, code: "TEST", seat: 0, token: "tok" });
  },
  close: () => {}, disconnect: () => {},
};
global.io = window.io = () => fakeSocket;
function serverSays(ev, payload) {
  (handlers[ev] || []).forEach((fn) => fn(payload));
}

// --- load the client ------------------------------------------------------
const src = fs.readFileSync(path.join(__dirname, "public", "client.js"), "utf8");
let loadError = null;
try {
  // the file ends by rendering into #root, exactly as the browser does
  // navigator must be passed in: Node 21+ has its own read-only global
  // navigator, so assigning global.navigator silently does nothing and the
  // client would see Node's (no clipboard, no vibrate) instead of jsdom's.
  new Function("React", "ReactDOM", "io", "window", "document", "localStorage", "navigator", src)(
    global.React, global.ReactDOM, global.io, window, global.document, global.localStorage, window.navigator);
} catch (e) {
  loadError = e;
}

// a state object shaped like sanitizeForSeat during an active round
function playingState(over) {
  const st = Object.assign({
    code: "TEST", phase: "playing", players: ["Pok", "Ann", null, null],
    mySeat: 0, myHand: [{ rank: "3", suit: "♣" }, { rank: "K", suit: "♠" }, { rank: "7", suit: "♥" }],
    handCounts: [3, 5, 6, 7], allHands: null,
    turn: 0, turnStartedAt: Date.now(), turnSeconds: 60,
    lastPlayerSeat: 1, passedThisTrick: [], trickPile: [{ cards: [{ rank: "5", suit: "♦" }], seat: 1 }],
    finished: [], round: 1, roundHistory: [], cumulative: [0, 0, 0, 0], payout: null,
    everPlayed: true, seatDraw: null, matchRoundsRemaining: null, matchLimit: null,
    finalCumulative: null, paused: null,
  }, over || {});
  // the server says who the host is; by default seat 0 is, as in a fresh room
  if (st.isHost === undefined) st.isHost = st.mySeat === 0;
  return st;
}

const text = () => document.body.textContent || "";
const buttons = () => [...document.querySelectorAll("button")];
const byLabel = (s) => buttons().find((b) => (b.textContent || "").includes(s));

(async () => {
  const settle = () => new Promise((r) => setTimeout(r, 60));

  console.log("\nthe client loads at all");
  ok("client.js evaluated without throwing" + (loadError ? ": " + loadError.message : ""), !loadError);
  if (loadError) { console.log("\n" + pass + " passed, " + ++fail + " failed\n"); process.exit(1); }

  // React 18 runs effects asynchronously, so the client has not subscribed to
  // the socket yet at this point. Anything emitted before this settle is lost.
  await settle();
  serverSays("connect");
  await settle();

  console.log("\nduring a round");
  serverSays("state", playingState());
  await settle();
  ok("no runtime errors while rendering the table", errors.length === 0);
  ok("the pause button is on screen", !!byLabel("พัก"));
  ok("the pause button is ENABLED during a round", byLabel("พัก") && !byLabel("พัก").disabled);
  ok("the rules button is on screen during play", !!byLabel("กติกา"));
  ok("both sort buttons are on screen", !!byLabel("เรียงเลข") && !!byLabel("เรียงดอก"));

  console.log("\npressing pause actually emits");
  sent.length = 0;
  if (byLabel("พัก")) byLabel("พัก").click();
  await settle();
  ok("clicking pause emits pauseGame", sent.some((m) => m.ev === "pauseGame"));

  console.log("\nwhile paused");
  serverSays("state", playingState({ paused: { by: "Pok", at: Date.now(), until: Date.now() + 300000 } }));
  await settle();
  ok("the paused overlay appears", text().includes("พักเกม"));
  ok("it names who paused", text().includes("Pok"));
  ok("the pause button is disabled while already paused", byLabel("พัก") && byLabel("พัก").disabled);
  ok("a resume button is offered", !!byLabel("เล่นต่อ"));
  sent.length = 0;
  if (byLabel("เล่นต่อ")) byLabel("เล่นต่อ").click();
  await settle();
  ok("clicking resume emits resumeGame", sent.some((m) => m.ev === "resumeGame"));

  console.log("\nthe rules screen");
  serverSays("state", playingState());
  await settle();
  if (byLabel("กติกา")) byLabel("กติกา").click();
  await settle();
  ok("rules open", text().includes("กติกา BIG2"));
  ok("they mention the flush rule", text().includes("เทียบทีละใบ"));
  ok("they mention J-Q-K-A-2", text().includes("J-Q-K-A-2"));

  console.log("\nsnap-pass appears only when waiting for your turn");
  serverSays("state", playingState({ turn: 1 })); // not my turn, live trick
  await settle();
  ok("snap-pass offered while waiting", !!byLabel("ผ่านล่วงหน้า"));
  ok("it sits in the bottom action row, immediately left of Play", (() => {
    const bs = buttons().map((b) => (b.textContent || "").trim());
    const sp = bs.findIndex((t) => t.includes("ผ่านล่วงหน้า"));
    const play = bs.findIndex((t) => t.includes("ลงไพ่"));
    return sp !== -1 && play === sp + 1;
  })());
  ok("it replaces the dead Pass button rather than adding a third",
     !buttons().some((b) => (b.textContent || "").trim() === "ผ่าน"));

  serverSays("state", playingState({ turn: 0 })); // my turn
  await settle();
  ok("snap-pass hidden on your own turn", !byLabel("ผ่านล่วงหน้า"));
  ok("the Pass button comes back on your turn",
     buttons().some((b) => (b.textContent || "").trim() === "ผ่าน"));

  console.log("\naction buttons");
  ok("Pass sits to the LEFT of Play", (() => {
    const bs = buttons().map((b) => b.textContent || "");
    const p = bs.findIndex((t) => t.trim() === "ผ่าน");
    const l = bs.findIndex((t) => t.includes("ลงไพ่"));
    return p !== -1 && l !== -1 && p < l;
  })());

  console.log("\ndragging cards around in your hand");
  // Rearranging the hand corrupted it: several pointermove events land before
  // React re-renders, so the reorder used to splice with a stale index -- it
  // removed somebody else's card and left the dragged key in the list twice.
  // Duplicate keys break React's reconciliation, and the hand renders as an
  // unusable pile of overlapping cards that no refresh clears.
  const bigHand = [
    { rank: "3", suit: "♣" }, { rank: "5", suit: "♦" }, { rank: "8", suit: "♥" },
    { rank: "J", suit: "♠" }, { rank: "K", suit: "♥" }, { rank: "2", suit: "♠" },
  ];
  // the cards in the fan, in the order they are laid out
  const handCards = () => [...document.querySelectorAll("div")].filter((d) => d.style.touchAction === "none");
  const cardLabels = () => handCards().map((d) => (d.textContent || "").trim());
  const pointer = (type, clientX) => new window.MouseEvent(type, { bubbles: true, clientX, clientY: 0 });

  serverSays("state", playingState({ myHand: bigHand, handCounts: [6, 5, 6, 7] }));
  await settle();
  ok("the whole hand is on screen before dragging", handCards().length === bigHand.length);

  const before = cardLabels();
  const dragged = handCards()[0];
  dragged.dispatchEvent(pointer("pointerdown", 0));
  await settle(); // the drag listeners go on in an effect, as they do in a browser
  // four moves back to back, with no chance to re-render in between
  [40, 90, 140, 190].forEach((x) => dragged.dispatchEvent(pointer("pointermove", x)));
  await settle();
  const during = cardLabels();
  ok("dragging keeps every card in the hand", during.length === bigHand.length);
  ok("dragging never duplicates or loses a card",
     new Set(during).size === bigHand.length && before.every((c) => during.includes(c)));
  ok("the dragged card actually moved along the fan", during[0] !== before[0]);

  // the finger comes up away from the fan -- on a phone that is anywhere on the
  // page, and it used to leave the card frozen mid-drag on top of everything
  window.dispatchEvent(pointer("pointerup", 190));
  await settle();
  ok("releasing outside the card ends the drag",
     handCards().every((d) => d.style.zIndex !== "50"));

  // a cancelled drag (the phone's long-press menu) must not leave the card deaf to taps
  handCards()[0].dispatchEvent(pointer("pointerdown", 0));
  window.dispatchEvent(pointer("pointermove", 90));
  await settle();
  window.dispatchEvent(pointer("pointercancel", 90));
  await settle();
  handCards()[0].dispatchEvent(pointer("pointerdown", 0));
  handCards()[0].dispatchEvent(pointer("pointerup", 0));
  await settle();
  ok("a tap still selects a card after a cancelled drag",
     !!byLabel("ลงไพ่ (1)"));

  console.log("\na new deal drops what was selected in the last one");
  // The selection used to survive the deal. The play button still read
  // "ลงไพ่ (1)" and stayed enabled, nothing in the fan looked selected, and
  // pressing it emitted a card that is no longer in the hand -- the server
  // rejects that, so the button looked dead until the selection was changed
  // by hand. Sorting or dragging was blamed for it; neither touches selection.
  const nextHand = [
    { rank: "4", suit: "♣" }, { rank: "6", suit: "♦" }, { rank: "9", suit: "♥" },
    { rank: "Q", suit: "♠" }, { rank: "A", suit: "♥" }, { rank: "7", suit: "♠" },
  ];
  // deal the other hand first, so this starts from an empty selection whatever
  // the tests above left behind
  serverSays("state", playingState({ myHand: nextHand, handCounts: [6, 5, 6, 7] }));
  await settle();
  serverSays("state", playingState({ myHand: bigHand, handCounts: [6, 5, 6, 7] }));
  await settle();
  handCards()[0].dispatchEvent(pointer("pointerdown", 0));
  await settle();
  handCards()[0].dispatchEvent(pointer("pointerup", 0));
  await settle();
  ok("a card is selected in the old hand", !!byLabel("ลงไพ่ (1)"));

  serverSays("state", playingState({ myHand: nextHand, handCounts: [6, 5, 6, 7] }));
  await settle();
  ok("the new deal drops the selection", !!byLabel("ลงไพ่ (0)"));
  ok("and no card in the new hand looks selected",
     handCards().every((d) => d.style.top !== "-14px"));
  sent.length = 0;
  const playAfterDeal = buttons().find((b) => (b.textContent || "").includes("ลงไพ่"));
  if (playAfterDeal && !playAfterDeal.disabled) playAfterDeal.click();
  await settle();
  ok("so a card that is not in the hand can never be played",
     !sent.some((m) => m.ev === "playCards"));

  // a selection you still hold is left alone: the hand also shrinks on your own
  // play, and mid-round state arrives constantly
  serverSays("state", playingState({ myHand: nextHand, handCounts: [6, 5, 6, 7] }));
  await settle();
  handCards()[0].dispatchEvent(pointer("pointerdown", 0));
  await settle();
  handCards()[0].dispatchEvent(pointer("pointerup", 0));
  await settle();
  serverSays("state", playingState({ myHand: nextHand, handCounts: [6, 5, 6, 7] }));
  await settle();
  ok("a card you still hold stays selected when state arrives",
     !!byLabel("ลงไพ่ (1)"));

  console.log("\nthe history screen");
  // The history is no longer part of the state broadcast -- it only ever grew,
  // and the state goes out on every play. Opening the screen fetches it.
  serverSays("state", playingState());
  await settle();
  sent.length = 0;
  // the opener is a stat tile, not a <button>
  const historyBtn = () => [...document.querySelectorAll("div")]
    .filter((d) => (d.textContent || "").includes("ประวัติ") && (d.textContent || "").length < 20).pop();
  ok("the history tile is on screen", !!historyBtn());
  if (historyBtn()) historyBtn().click();
  await settle();
  ok("opening it asks the server", sent.some((m) => m.ev === "getHistory"));
  ok("the fetched history is shown", text().includes("ประวัติคะแนน") && !!byLabel("สรุป"));
  if (byLabel("สรุป")) byLabel("สรุป").click();
  await settle();
  ok("the round detail shows what everyone was dealt", text().includes("ไพ่ตั้งต้น"));
  ok("and what they were left holding", text().includes("ไพ่ที่เหลือ"));
  if (byLabel("ปิด")) byLabel("ปิด").click();
  await settle();
  if (byLabel("ปิด")) byLabel("ปิด").click();
  await settle();

  console.log("\nseat boxes keep their size, whatever the name");
  const seatBoxes = () => [...document.querySelectorAll("div")].filter((d) => d.style.height === "76px" && d.style.width);
  serverSays("state", playingState({ players: ["Pok", "Ann", "Bob", "Cat"] }));
  await settle();
  const shortWidths = seatBoxes().map((d) => d.style.width);
  serverSays("state", playingState({
    players: ["Pok", "ชื่อยาวมากๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆ", "Bartholomew-Maximilian-the-Third", "Cat"],
  }));
  await settle();
  const longWidths = seatBoxes().map((d) => d.style.width);
  ok("there is a box for each of the other three players", shortWidths.length === 3 && longWidths.length === 3);
  ok("each has a fixed width, not a minimum", shortWidths.every((w) => w === "64px"));
  ok("a very long name does not change it", longWidths.join() === shortWidths.join());
  const nameSpan = (label) => [...document.querySelectorAll("span")].find((sp) => (sp.textContent || "").startsWith(label));
  const longEn = nameSpan("Bartholomew");
  ok("a long name is cut with an ellipsis instead of stretching the box",
     longEn && longEn.style.textOverflow === "ellipsis" && longEn.style.overflow === "hidden" && longEn.style.whiteSpace === "nowrap");
  ok("and steps down a size first", longEn && parseFloat(longEn.style.fontSize) < 12);
  ok("a short name keeps the normal size", nameSpan("Cat") && parseFloat(nameSpan("Cat").style.fontSize) === 12);
  serverSays("state", playingState({ players: ["Pok", "Bartholomew-Maximilian-the-Third", "Bob", "Cat"], finished: [1] }));
  await settle();
  const tick = [...document.querySelectorAll("span")].find((sp) => sp.textContent === "✅");
  ok("the finished tick is its own element, so a long name cannot push it out", !!tick && tick.style.flexShrink === "0");
  ok("the box is still the same size with the tick", seatBoxes().every((d) => d.style.width === "64px"));

  console.log("\ntapping the table lists the trick that is on it");
  // the trick on the table, oldest first -- exactly what the server puts in trickPile
  const trick1 = [
    { seat: 1, cards: [cc("5", "♦")] },
    { seat: 0, cards: [cc("K", "♠")] },
    { seat: 2, cards: [cc("8", "♦"), cc("8", "♣")] },
  ];
  serverSays("state", playingState({ trickPile: trick1 }));
  await settle();
  const felt = () => [...document.querySelectorAll("div")].find((d) => d.style.borderRadius === "50%" && d.style.cursor === "pointer");
  const playsModal = () => [...document.querySelectorAll("div")].find((d) => d.style.position === "fixed" && (d.textContent || "").includes("ไพ่ที่ลงในกองนี้"));
  ok("the table is tappable during a round", !!felt());
  ok("nothing is open yet", !playsModal());
  sent.length = 0;
  if (felt()) felt().click();
  await settle();
  ok("tapping it shows the list", !!playsModal());
  ok("and asks the server for nothing: the trick is already in the state", sent.length === 0);
  const pm = () => (playsModal() ? playsModal().textContent : "");
  ok("numbered from 1, with who played and what, in order",
     pm().includes("1Ann5♦") && pm().includes("2คุณK♠") && pm().indexOf("1Ann") < pm().indexOf("2คุณ") && pm().indexOf("2คุณ") < pm().indexOf("3บอท 3"));
  ok("your own plays say คุณ, the bots' say their name", pm().includes("2คุณ") && pm().includes("บอท 3"));
  ok("a pair is shown as both cards, smallest first", pm().includes("3บอท 38♣8♦"));
  ok("it says an old trick goes when somebody leads again", pm().includes("กองเก่าจะหายไป"));

  // somebody plays on: the open list follows the table
  serverSays("state", playingState({ trickPile: [...trick1, { seat: 3, cards: [cc("Q", "♣"), cc("Q", "♥")] }] }));
  await settle();
  ok("while it is open, a new play is added to it", pm().includes("4บอท 4"));

  // everyone passed and a new player leads: the pile on the table is a new one
  serverSays("state", playingState({ trickPile: [{ seat: 2, cards: [cc("4", "♣")] }] }));
  await settle();
  ok("after a fresh lead the list is only the new trick", pm().includes("1บอท 34♣") && !pm().includes("Ann") && !pm().includes("K♠"));
  ok("none of the old trick can be found in it", !pm().includes("8♦") && !pm().includes("Q♣") && !pm().includes("5♦"));
  ok("and it is numbered from 1 again", !pm().includes("2"));
  serverSays("state", playingState({ trickPile: [] }));
  await settle();
  ok("with nothing on the table there is nothing to list", pm().includes("ยังไม่มีใครลงไพ่ในกองนี้"));

  const roundOver = (over) => playingState(Object.assign({
    phase: "finished", turn: null, finished: [1], round: 3, handCounts: [12, 0, 4, 3],
    allHands: [deal("♣").slice(0, 12), [], deal("♦").slice(0, 4), deal("♥").slice(0, 3)],
    payout: { net: [-9, 15, -3, -3], scores: [36, 0, 4, 3], points: [12, 0, 4, 3] },
  }, over || {}));
  serverSays("state", roundOver());
  await settle();
  ok("when the round ends the list closes by itself", !playsModal());
  serverSays("state", playingState({ mySeat: -1, myHand: [], code: null, observers: 1, trickPile: trick1 }));
  await settle();
  if (felt()) felt().click();
  await settle();
  ok("someone watching can tap the table too", !!playsModal() && pm().includes("1Ann5♦"));
  serverSays("state", playingState());
  await settle();

  console.log("\na turn the server is about to pass for you");
  const passBtn = () => buttons().find((b) => (b.textContent || "").trim() === "ผ่าน");
  serverSays("state", playingState({ turn: 0, autoPassSeat: 0, myHand: [cc("K", "♠")], handCounts: [1, 5, 6, 7],
    lastPlayerSeat: 1, trickPile: [{ cards: [cc("8", "♣"), cc("8", "♦")], seat: 1 }] }));
  await settle();
  ok("the banner says why nothing is asked of you", text().includes("ไพ่ไม่พอสู้") && text().includes("ผ่านให้อัตโนมัติ"));
  ok("instead of the usual turn banner", !text().includes("ตาคุณ!"));
  ok("Pass is off (the server does it)", passBtn() && passBtn().disabled);
  ok("Play is off too", byLabel("ลงไพ่") && byLabel("ลงไพ่").disabled);
  serverSays("state", playingState({ turn: 0 }));
  await settle();
  ok("on an ordinary turn the banner is the usual one", text().includes("ตาคุณ!") && !text().includes("ไพ่ไม่พอสู้"));
  ok("and Pass works", passBtn() && !passBtn().disabled);

  console.log("\nafter a round: asking the multiplied about a reseat");
  const rulesBtnText = () => text();
  serverSays("state", roundOver({ seatPrompt: { seat: 0, leg: 4, until: Date.now() + 8000 } }));
  await settle();
  ok("the multiplied player is asked", text().includes("จะจับที่นั่งใหม่ไหม?"));
  ok("and told how much they were multiplied", text().includes("คุณโดนคูณ ×3"));
  ok("and which leg they would be", text().includes("ตาต่อไปคุณจะเป็นขาที่ 4"));
  ok("the last leg is called out", text().includes("ขาสุดท้าย"));
  ok("with a countdown that counts down from what the server said", /เลือกภายใน [1-8] วินาที/.test(text()));
  ok("Yes and No are both offered", !!byLabel("ใช่ — จับที่นั่งใหม่") && !!byLabel("เล่นต่อที่เดิม"));
  sent.length = 0;
  byLabel("ใช่ — จับที่นั่งใหม่").click();
  await settle();
  const yes = sent.find((m) => m.ev === "answerSeatDraw");
  ok("Yes is sent as a yes, with the room", yes && yes.payload.choice === true && yes.payload.code === "TEST");
  sent.length = 0;
  byLabel("เล่นต่อที่เดิม").click();
  await settle();
  const no = sent.find((m) => m.ev === "answerSeatDraw");
  ok("No is sent as a no", no && no.payload.choice === false);
  serverSays("state", roundOver({ handCounts: [10, 0, 4, 3], seatPrompt: { seat: 0, leg: 3, until: Date.now() + 8000 } }));
  await settle();
  ok("10-11 cards left is a x2", text().includes("คุณโดนคูณ ×2"));
  ok("a leg that is not the last one isn't called the last", text().includes("ตาต่อไปคุณจะเป็นขาที่ 3") && !text().includes("ขาสุดท้าย"));

  serverSays("state", roundOver({ seatPrompt: { seat: 1, leg: 3, until: Date.now() + 8000 } }));
  await settle();
  ok("when it is somebody else's question there is no question for you", !byLabel("ใช่ — จับที่นั่งใหม่"));
  ok("you are told who the table is waiting for", text().includes("รอ Ann เลือกว่าจะจับที่นั่งใหม่ไหม"));
  serverSays("state", roundOver({ mySeat: -1, myHand: [], code: null, seatPrompt: { seat: 1, leg: 3, until: Date.now() + 8000 } }));
  await settle();
  ok("an observer sees who is being asked but is never asked", !byLabel("ใช่ — จับที่นั่งใหม่") && text().includes("รอ Ann เลือก"));
  serverSays("state", roundOver());
  await settle();
  ok("with nobody being asked, the round just rolls on", text().includes("กำลังเริ่มรอบต่อไปอัตโนมัติ") && !text().includes("จะจับที่นั่งใหม่ไหม"));
  serverSays("state", playingState());
  await settle();

  console.log("\nthe rules screen covers the new behaviour");
  if (byLabel("กติกา")) byLabel("กติกา").click();
  await settle();
  ok("the last-card rule says it is the NEXT SEAT that counts", text().includes("ดูที่นั่งถัดไปจริงๆ"));
  ok("there is an auto-pass section", text().includes("ผ่านให้อัตโนมัติ"));
  ok("and a reseat section", text().includes("ถามจากขาสุดท้ายก่อน"));
  ok("and the round-plays list", text().includes("แตะที่โต๊ะสีเขียว"));
  if (byLabel("ปิด")) byLabel("ปิด").click();
  await settle();

  console.log("\nwatching: all four players are shown the same way");
  serverSays("state", playingState());
  await settle();
  ok("a player sees the three other players around the table", seatBoxes().length === 3);
  serverSays("state", playingState({ mySeat: -1, myHand: [], code: null, observers: 1, players: ["Pok", "Ann", "Bob", "Cat"] }));
  await settle();
  ok("a watcher sees a box for each of the four", seatBoxes().length === 4);
  ok("...and they are the same fixed size", seatBoxes().every((d) => d.style.width === "64px"));
  const shown = seatBoxes().map((d) => d.textContent);
  ok("with all four names", ["Pok", "Ann", "Bob", "Cat"].every((n) => shown.some((t) => t.includes(n))));
  ok("no player-style strip of their own (cards left / running score)", !text().includes("คะแนนสะสม") && !text().includes("ไพ่ของ"));
  ok("the history tile is still there", !!document.querySelector("div[style*='width: 56px']") && text().includes("ประวัติ"));
  ok("a watcher cannot pause", !byLabel("พัก"));
  ok("and is not offered the last-rounds button", !byLabel("4 ตาสุดท้าย"));
  serverSays("state", playingState());
  await settle();

  console.log("\nthe 4-last-rounds button stays put");
  const lastBtn = () => buttons().find((b) => (b.textContent || "").includes("4 ตาสุดท้าย") && !(b.textContent || "").includes("เล่นแบบ"));
  const dim = (b) => b && b.getAttribute("aria-disabled") === "true";
  const settingsSpan = () => [...document.querySelectorAll("span")].find((sp) => (sp.textContent || "").startsWith("⚙️ ตั้งค่า"));
  serverSays("state", playingState({ mySeat: 2, isHost: true, players: ["Ann", "Bob", "Pok", null] }));
  await settle();
  ok("the host has it during a round, in whatever seat they now sit", !!lastBtn() && !dim(lastBtn()));
  ok("it sits directly under the settings button",
     settingsSpan() && lastBtn() && settingsSpan().parentElement.nextElementSibling.contains(lastBtn()));
  ok("it is no longer up beside the room name", ![...document.querySelectorAll("span")].some((sp) => (sp.textContent || "").trim() === "🏁 4 ตาสุดท้าย"));
  serverSays("state", playingState({ mySeat: 0, isHost: false }));
  await settle();
  ok("a player who is not the host still sees it (it does not come and go)", !!lastBtn());
  ok("but dimmed", dim(lastBtn()));
  sent.length = 0;
  lastBtn().click();
  await settle();
  ok("pressing it says why nothing happens", text().includes("เฉพาะเจ้าของห้องกดได้"));
  ok("and asks nothing of the server", !sent.some((m) => m.ev === "startLastRounds"));
  ok("and no dialog", !text().includes("เล่น 4 ตาสุดท้าย?"));
  serverSays("state", playingState({ matchRoundsRemaining: 3 }));
  await settle();
  ok("once the countdown is running the button is still there", !!lastBtn());
  ok("dimmed, with the count shown up top as before", dim(lastBtn()) && text().includes("เหลืออีก 3 ตา"));
  serverSays("state", playingState({ matchDeadline: Date.now() + 30 * 60000 }));
  await settle();
  ok("in a timed match it is there too, next to the clock", !!lastBtn() && text().includes("เหลือ 30 นาที") && !dim(lastBtn()));

  serverSays("state", playingState());
  await settle();
  sent.length = 0;
  lastBtn().click();
  await settle();
  ok("the host pressing it gets a confirmation", text().includes("เล่น 4 ตาสุดท้าย?") && text().includes("กดแล้วยกเลิกไม่ได้"));
  ok("and nothing is sent yet", !sent.some((m) => m.ev === "startLastRounds"));
  byLabel("ยกเลิก").click();
  await settle();
  ok("Cancel closes it without sending anything", !text().includes("เล่น 4 ตาสุดท้าย?") && !sent.some((m) => m.ev === "startLastRounds"));
  lastBtn().click();
  await settle();
  byLabel("ยืนยัน").click();
  await settle();
  const lastMsg = sent.find((m) => m.ev === "startLastRounds");
  ok("Confirm sends it, for this room", lastMsg && lastMsg.payload.code === "TEST");
  ok("and the dialog closes", !text().includes("เล่น 4 ตาสุดท้าย?"));
  serverSays("state", playingState({ matchRoundsRemaining: 4 }));
  await settle();
  sent.length = 0;
  lastBtn().click();
  await settle();
  ok("with the countdown on, pressing it does nothing more", !text().includes("เล่น 4 ตาสุดท้าย?") && !sent.some((m) => m.ev === "startLastRounds"));
  serverSays("state", playingState());
  await settle();

  console.log("\nthe waiting room asks too");
  serverSays("state", playingState({ phase: "waiting", myHand: [] }));
  await settle();
  sent.length = 0;
  ok("the host is offered it there", !!byLabel("เล่นแบบ"));
  byLabel("เล่นแบบ").click();
  await settle();
  ok("and is asked to confirm", text().includes("เล่น 4 ตาสุดท้าย?") && !sent.some((m) => m.ev === "startLastRounds"));
  byLabel("ยืนยัน").click();
  await settle();
  ok("confirming sends it", sent.some((m) => m.ev === "startLastRounds"));
  serverSays("state", playingState({ phase: "waiting", myHand: [], mySeat: 1, isHost: false }));
  await settle();
  ok("a guest is not offered it", !byLabel("เล่นแบบ"));
  serverSays("state", playingState());
  await settle();

  console.log("\nthe host is whoever the server says, not whoever sits lowest");
  serverSays("state", roundOver({ phase: "gameover", mySeat: 0, isHost: false, finalCumulative: [7, -3, 0, -4] }));
  await settle();
  ok("seat 0 who is not the host is not offered a new match", !byLabel("เล่นแมตช์ใหม่"));
  serverSays("state", roundOver({ phase: "gameover", mySeat: 3, isHost: true, finalCumulative: [7, -3, 0, -4] }));
  await settle();
  ok("the host in seat 3 is", !!byLabel("เล่นแมตช์ใหม่"));
  serverSays("state", playingState());
  await settle();

  console.log("\nthe stats row: cards left, score, pause, history");
  const pauseBtn = () => buttons().find((b) => (b.textContent || "").includes("พัก"));
  const histTile = () => [...document.querySelectorAll("div")].find((d) => d.style.width === "56px" && (d.textContent || "").includes("ประวัติ"));
  const statRow = () => (histTile() ? histTile().parentElement : null);
  ok("pause is a button in the stats row", !!pauseBtn() && !!statRow() && statRow().contains(pauseBtn()));
  ok("immediately to the LEFT of history", statRow() && pauseBtn().nextElementSibling === histTile());
  ok("the same size as history", pauseBtn().style.width === histTile().style.width && pauseBtn().style.height === histTile().style.height);
  const wide = statRow() ? [...statRow().children].slice(0, 2) : [];
  ok("cards left and running score come first", wide.length === 2 && wide[0].textContent.includes("ใบ") && wide[1].textContent.includes("คะแนนสะสม"));
  ok("they share what is left equally", wide.length === 2 && wide[0].style.flex === wide[1].style.flex && wide[0].style.padding === wide[1].style.padding);
  ok("four things in the row, no more", statRow() && statRow().children.length === 4);
  ok("pause is gone from the sort row", !byLabel("เรียงเลข").parentElement.contains(pauseBtn()));
  serverSays("state", playingState({ paused: { by: "Pok", at: Date.now(), until: Date.now() + 300000 } }));
  await settle();
  ok("while paused the tile is dimmed and off", pauseBtn().disabled && parseFloat(pauseBtn().style.opacity) < 1);
  serverSays("state", playingState());
  await settle();

  console.log("\ninvite link");
  serverSays("state", { code: "KQ7M", phase: "waiting", players: ["Pok", null, null, null],
    mySeat: 0, isHost: true, myHand: [], handCounts: [0, 0, 0, 0], allHands: null, turn: null,
    turnStartedAt: null, turnSeconds: 30, lastPlayerSeat: null, passedThisTrick: [],
    trickPile: [], finished: [], round: 0, roundHistory: [], cumulative: [0, 0, 0, 0],
    payout: null, everPlayed: false, seatDraw: null, matchRoundsRemaining: null,
    matchLimit: null, finalCumulative: null, paused: null });
  await settle();
  ok("the waiting room offers a copy-invite button", !!byLabel("คัดลอกลิงก์"));
  ok("the waiting room offers the rules", !!byLabel("ดูกติกา"));
  ok("match-end settings are offered to the host", text().includes("จบแมตช์เมื่อ"));

  // ending on the clock: play for N minutes, then the last 4 rounds
  ok("ending on time is one of the choices", !!byLabel("ครบเวลา"));
  sent.length = 0;
  if (byLabel("ครบเวลา")) byLabel("ครบเวลา").click();
  await settle();
  const limitMsg = sent.find((m) => m.ev === "setMatchLimit");
  ok("choosing it sends a time limit in minutes",
     limitMsg && limitMsg.payload.type === "time" && limitMsg.payload.value > 0);

  let copiedText = null;
  window.navigator.clipboard = { writeText: (t) => { copiedText = t; return Promise.resolve(); } };
  if (byLabel("คัดลอกลิงก์")) byLabel("คัดลอกลิงก์").click();
  await settle();
  ok("it copies a link containing the room code", /\?room=KQ7M$/.test(copiedText || ""));
  ok("and confirms it copied", text().includes("คัดลอกแล้ว"));

  console.log("\nthe clock on a timed match");
  serverSays("state", playingState({ matchDeadline: Date.now() + 45 * 60000 }));
  await settle();
  ok("the table shows how long is left", text().includes("⏱ เหลือ 45 นาที"));
  serverSays("state", playingState({ matchDeadline: Date.now() + 1000 }));
  await settle();
  ok("the last minute still reads as a minute, not zero", text().includes("⏱ เหลือ 1 นาที"));
  serverSays("state", playingState({ matchDeadline: null, matchRoundsRemaining: 4 }));
  await settle();
  ok("once time is up the badge becomes the round countdown",
     text().includes("เหลืออีก 4 ตา") && !text().includes("⏱ เหลือ"));

  console.log("\nrecovering when the server slept and the room is gone");
  serverSays("state", playingState());
  await settle();
  ok("we are on the table before the server sleeps", text().includes("ไพ่ในมือคุณ"));
  // a real player has a saved session; that is what the client rejoins with
  localStorage.setItem("big2session", JSON.stringify({ name: "Pok", code: "TEST", token: "tok" }));
  joinShouldFail = true;          // the room no longer exists
  serverSays("connect");          // socket.io reconnects and tries to rejoin
  await settle();
  ok("we are NOT left on a dead table", !text().includes("ไพ่ในมือคุณ"));
  ok("we are returned to the lobby", !!byLabel("สร้างห้องใหม่"));
  ok("and told why", text().includes("ไม่พบห้องนี้"));

  console.log("\nthe lobby sign board");
  // the previous block left us in the lobby
  const refreshLink = () => [...document.querySelectorAll("span")].find((s) => (s.textContent || "").trim() === "รีเฟรช");
  ok("the lobby offers a refresh", !!refreshLink());
  roomsOnAir = [{ players: ["Pok", "Ann", null, null], phase: "playing", round: 7 }];
  if (refreshLink()) refreshLink().click();
  await settle();
  ok("it lists who is playing", text().includes("Pok, Ann"));
  ok("it fills the empty seats in as bots", text().includes("บอท 3"));
  ok("it says how far along they are", text().includes("รอบที่ 7"));
  ok("it counts the rooms", text().includes("กำลังเล่นอยู่ 1 ห้อง"));

  roomsOnAir = [];
  if (refreshLink()) refreshLink().click();
  await settle();
  ok("it says so when nobody is playing", text().includes("ยังไม่มีใครเล่นอยู่ตอนนี้"));

  console.log("\nwatching a game from the lobby");
  roomsOnAir = [{ players: ["Pok", "Ann", null, null], phase: "playing", round: 7, watchId: "watch-1", observers: 0 }];
  if (refreshLink()) refreshLink().click();
  await settle();
  const watchBtn = () => buttons().find((b) => (b.textContent || "").includes("เข้าไปดู"));
  ok("the board offers a way to watch", !!watchBtn());
  sent.length = 0;
  if (watchBtn()) watchBtn().click();
  await settle();
  const watchMsg = sent.find((m) => m.ev === "observeRoom");
  ok("it asks with the watch id and not a room code",
     watchMsg && watchMsg.payload.watchId === "watch-1" && !watchMsg.payload.code);

  // what the server actually sends a watcher: no seat, no hand, no room code
  errors.length = 0;
  serverSays("state", playingState({ mySeat: -1, myHand: [], code: null, observers: 1 }));
  await settle();
  ok("the table renders for a watcher without errors", errors.length === 0);
  ok("the watcher is told they are watching", text().includes("โหมดผู้ชม"));
  ok("no hand of their own is offered", !text().includes("ไพ่ในมือคุณ"));
  ok("the play button is not there at all", !buttons().some((b) => (b.textContent || "").includes("ลงไพ่")));
  ok("neither are the sort buttons", !byLabel("เรียงเลข"));
  ok("the chat box is hidden", // the banner says "แชทไม่ได้", so look for the input itself
     ![...document.querySelectorAll("input")].some((i) => (i.placeholder || "").includes("แชท")));
  // mySeat -1 used to index cumulative[-1] and players[-1]
  ok("nothing renders as undefined", !text().includes("undefined"));

  sent.length = 0;
  ok("they are offered a way out", !!byLabel("เลิกดู"));
  if (byLabel("เลิกดู")) byLabel("เลิกดู").click();
  await settle();
  ok("stopping tells the server", sent.some((m) => m.ev === "stopObserving"));
  ok("and lands back in the lobby", !!byLabel("สร้างห้องใหม่"));

  serverSays("state", playingState({ observers: 2 }));
  await settle();
  ok("the players are shown how many are watching", text().includes("👁 2"));
  ok("and the players still get their own hand", text().includes("ไพ่ในมือคุณ"));

  // somebody watching a room that has not started yet is the common case:
  // the lobby board lists rooms while they are still filling up
  serverSays("state", playingState({ phase: "waiting", myHand: [], observers: 1 }));
  await settle();
  ok("the waiting room shows the watcher too", text().includes("👁 1"));

  // A dropped connection reconnects and sits back down on its own, but a table
  // that just freezes looks broken — and people go looking for another browser,
  // which is where the seat token that gets them back in was left behind.
  console.log("\nlosing the connection");
  serverSays("disconnect");
  await settle();
  ok("the table says the connection dropped", text().includes("หลุดการเชื่อมต่อ"));
  serverSays("connect");
  await settle();
  ok("and the notice goes away once it is back", !text().includes("หลุดการเชื่อมต่อ"));

  console.log("\nthe end-of-match summary");
  // The summary is a full-screen overlay, so the "ออกจากห้อง" link in the page
  // header is underneath it and unreachable. Without a way out inside the
  // overlay, reopening the site rejoins the room and lands here again.
  const overlay = () => [...document.querySelectorAll("div")].find((d) => d.style.zIndex === "1000");
  const leaveLink = () => overlay() &&
    [...overlay().querySelectorAll("span")].find((s) => (s.textContent || "").trim() === "ออกจากห้อง");

  serverSays("state", playingState({ phase: "gameover", mySeat: 1, finalCumulative: [7, -3, 0, -4] }));
  await settle();
  ok("the summary appears", text().includes("จบแมตช์!"));
  ok("a player who is not the host still gets a way out", !!leaveLink());

  serverSays("state", playingState({ phase: "gameover", mySeat: 0, finalCumulative: [7, -3, 0, -4] }));
  await settle();
  ok("the host is still offered a new match", !!byLabel("เล่นแมตช์ใหม่"));
  ok("the host gets a way out too", !!leaveLink());

  localStorage.setItem("big2session", JSON.stringify({ name: "Pok", code: "TEST", token: "tok" }));
  sent.length = 0;
  if (leaveLink()) leaveLink().click();
  await settle();
  ok("leaving forgets the saved session, so the next visit starts in the lobby",
     !localStorage.getItem("big2session"));
  // ...and the server has to hear about it, or the seat goes on holding this
  // name and answers "ห้องเต็มแล้ว" when they come back
  ok("leaving gives the seat up on the server too", sent.some((m) => m.ev === "leaveRoom"));

  console.log("\narriving through an invite link");
  // A second browser, this time with ?room= in the URL. The client has to be
  // loaded again because URL_ROOM is read once, when the file is evaluated.
  // Someone who followed a link came for one specific room, so the board of
  // other people's games would only be in the way.
  const dom2 = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost/?room=KQ7M", pretendToBeVisual: true });
  const w2 = dom2.window;
  new Function("React", "ReactDOM", "io", "window", "document", "localStorage", "navigator", src)(
    global.React, global.ReactDOM, () => fakeSocket, w2, w2.document, w2.localStorage, w2.navigator);
  await settle();
  const text2 = w2.document.body.textContent || "";
  ok("the join form is still there", text2.includes("เข้าร่วมห้อง"));
  ok("the room code from the link is filled in",
     [...w2.document.querySelectorAll("input")].some((i) => i.value === "KQ7M"));
  ok("the sign board is hidden", !text2.includes("รีเฟรช") && !text2.includes("ห้องที่เล่นอยู่"));

  console.log("\ntyping your way back into a room you were already in");
  // Typing the name again is what happens after a crash or a browser restart,
  // and a phone keyboard may capitalise it. The seat token in storage is the
  // only thing that still identifies the seat, so the join has to carry it.
  w2.localStorage.setItem("big2session", JSON.stringify({ name: "pok", code: "KQ7M", token: "seat-tok-1" }));
  const nameInput = [...w2.document.querySelectorAll("input")].find((i) => i.value !== "KQ7M");
  const nativeValue = Object.getOwnPropertyDescriptor(w2.HTMLInputElement.prototype, "value").set;
  nativeValue.call(nameInput, "Pok"); // as the phone would capitalise it
  nameInput.dispatchEvent(new w2.Event("input", { bubbles: true }));
  await settle();
  sent.length = 0;
  [...w2.document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("เข้าร่วมห้อง")).click();
  await settle();
  const joinMsg = sent.find((m) => m.ev === "joinRoom");
  ok("the join is sent", !!joinMsg);
  ok("it carries the saved seat token", joinMsg && joinMsg.payload.token === "seat-tok-1");
  ok("it sends the name as typed", joinMsg && joinMsg.payload.name === "Pok");

  // Same phone, next person. They type their own name, so the seat token left
  // behind by the previous player must NOT be attached -- otherwise they are
  // handed that player's seat and hand.
  nativeValue.call(nameInput, "Ann");
  nameInput.dispatchEvent(new w2.Event("input", { bubbles: true }));
  await settle();
  sent.length = 0;
  [...w2.document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("เข้าร่วมห้อง")).click();
  await settle();
  const annJoin = sent.find((m) => m.ev === "joinRoom");
  ok("someone else on the same phone joins without the stored token",
     annJoin && !annJoin.payload.token);

  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
