/* Characterization tests for gameLogic.js — Thai Big 2 rules.
 *
 * These record what the code ALREADY does, so refactoring can't silently
 * change the rules. Run:  npm test
 */
const G = require("./gameLogic");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}
function eq(name, got, want) {
  ok(name + (got === want ? "" : "  (got " + got + ", want " + want + ")"), got === want);
}

const c = (rank, suit) => ({ rank, suit });
const H = (...specs) => specs.map(s => c(s.slice(0, -1), s.slice(-1)));
const type = (...specs) => { const r = G.classifyCombo(H(...specs)); return r && r.type; };
const beats = (a, b) => G.comboBeats(G.classifyCombo(a), G.classifyCombo(b), a, b);

console.log("\ncard ordering");
eq("3♣ is the weakest card", G.cardValue(c("3", "♣")), 0);
eq("2♠ is the strongest card", G.cardValue(c("2", "♠")), 51);
ok("suit order is ♣ < ♦ < ♥ < ♠",
   G.cardValue(c("5", "♣")) < G.cardValue(c("5", "♦")) &&
   G.cardValue(c("5", "♦")) < G.cardValue(c("5", "♥")) &&
   G.cardValue(c("5", "♥")) < G.cardValue(c("5", "♠")));
ok("2 outranks A", G.cardValue(c("2", "♣")) > G.cardValue(c("A", "♠")));

console.log("\ncombo shapes");
eq("single", type("7♥"), "single");
eq("pair", type("7♥", "7♣"), "pair");
eq("triple", type("9♥", "9♣", "9♦"), "triple");
eq("standalone quad", type("6♥", "6♣", "6♦", "6♠"), "quad");
eq("straight", type("3♣", "4♦", "5♥", "6♠", "7♣"), "straight");
eq("flush", type("3♥", "7♥", "9♥", "J♥", "K♥"), "flush");
eq("full house", type("4♣", "4♦", "4♥", "9♠", "9♣"), "fullhouse");
eq("quad + kicker", type("6♣", "6♦", "6♥", "6♠", "K♣"), "quadkick");
eq("straight flush", type("5♠", "6♠", "7♠", "8♠", "9♠"), "straightflush");
ok("mismatched pair is not a combo", type("7♥", "8♣") === null);
ok("random five cards is not a combo", type("3♣", "7♦", "9♥", "J♠", "K♣") === null);

console.log("\nfive-card ranking: straight < flush < full house < quad+kick < straight flush");
ok("flush beats straight", beats(H("3♥", "7♥", "9♥", "J♥", "K♥"), H("3♣", "4♦", "5♥", "6♠", "7♣")));
ok("full house beats flush", beats(H("4♣", "4♦", "4♥", "9♠", "9♣"), H("3♥", "7♥", "9♥", "J♥", "K♥")));
ok("quad+kicker beats full house", beats(H("6♣", "6♦", "6♥", "6♠", "K♣"), H("4♣", "4♦", "4♥", "9♠", "9♣")));
ok("straight flush beats quad+kicker", beats(H("5♠", "6♠", "7♠", "8♠", "9♠"), H("6♣", "6♦", "6♥", "6♠", "K♣")));

console.log("\nhouse rule: flush compares every rank from the top, then suit");
ok("A♠K♠5♠4♠3♠ beats A♥Q♥J♥10♥9♥ (A ties, K > Q)",
   beats(H("A♠", "K♠", "5♠", "4♠", "3♠"), H("A♥", "Q♥", "J♥", "10♥", "9♥")));
ok("and not the other way round",
   !beats(H("A♥", "Q♥", "J♥", "10♥", "9♥"), H("A♠", "K♠", "5♠", "4♠", "3♠")));
ok("identical ranks fall through to suit",
   beats(H("A♠", "K♠", "9♠", "5♠", "3♠"), H("A♥", "K♥", "9♥", "5♥", "3♥")));

console.log("\nhouse rule: wrap straights outrank every normal straight");
eq("A-2-3-4-5 is a straight", type("A♣", "2♦", "3♥", "4♠", "5♣"), "straight");
eq("2-3-4-5-6 is a straight", type("2♣", "3♦", "4♥", "5♠", "6♣"), "straight");
ok("A-2-3-4-5 beats 10-J-Q-K-A",
   beats(H("A♣", "2♦", "3♥", "4♠", "5♣"), H("10♣", "J♦", "Q♥", "K♠", "A♣")));
ok("A-2-3-4-5 beats 2-3-4-5-6",
   beats(H("A♣", "2♦", "3♥", "4♠", "5♣"), H("2♣", "3♦", "4♥", "5♠", "6♣")));
ok("J-Q-K-A-2 is NOT a straight (2 only wraps in the two special runs)",
   type("J♣", "Q♦", "K♥", "A♠", "2♣") === null);

console.log("\nhouse rule: bigger shapes take smaller ones");
ok("a triple beats a single", beats(H("9♥", "9♣", "9♦"), H("2♠")));
ok("a standalone quad beats a pair", beats(H("6♥", "6♣", "6♦", "6♠"), H("2♠", "2♥")));
ok("a pair does NOT beat a single", !beats(H("2♠", "2♥"), H("A♠")));
ok("five cards do NOT beat a triple", !beats(H("5♠", "6♠", "7♠", "8♠", "9♠"), H("9♥", "9♣", "9♦")));
ok("a quad does NOT beat a single", !beats(H("6♥", "6♣", "6♦", "6♠"), H("A♠")));

console.log("\nscoring");
eq("a 2 is worth 5 points", G.handPoints(H("2♣")), 5);
eq("an A is worth 2 points", G.handPoints(H("A♣")), 2);
eq("everything else is worth 1", G.handPoints(H("3♣", "9♦", "K♥")), 3);
eq("under 10 cards: no multiplier", G.playerScore(H("2♣", "A♣", "3♦")), 8);
eq("10 or 11 cards left doubles",
   G.playerScore(H("3♣", "4♣", "5♣", "6♣", "7♣", "8♣", "9♣", "10♣", "J♣", "Q♣")), 20);
eq("12 or more triples",
   G.playerScore(H("3♣", "4♣", "5♣", "6♣", "7♣", "8♣", "9♣", "10♣", "J♣", "Q♣", "K♣", "3♦")), 36);

console.log("\npayouts settle pairwise between all four players");
const pay = G.computePayouts([[], H("3♦"), H("3♥", "3♠"), H("2♠")]);
eq("winner's score is 0", pay.scores[0], 0);
eq("raw points ship alongside the multiplied scores", pay.points.join(","), "0,1,2,5");
ok("points match handPoints exactly (the client reads these instead of recomputing)",
   pay.points.every((p, i) => p === G.handPoints([[], H("3♦"), H("3♥", "3♠"), H("2♠")][i])));
eq("payouts sum to zero", pay.net.reduce((a, b) => a + b, 0), 0);
ok("winner is paid by everyone", pay.net[0] > 0);
ok("the biggest loser pays the most", pay.net[3] === Math.min(...pay.net));

console.log("\ntrick resolution");
ok("trick resets once every other live seat has passed",
   G.trickShouldReset([], [1, 2, 3], 0) === true);
ok("trick does not reset while someone can still answer",
   G.trickShouldReset([], [1], 0) === false);
ok("seats that already went out don't block the reset",
   G.trickShouldReset([2], [1, 3], 0) === true);
eq("lead returns to the trick owner on reset",
   G.resolveNextTurn([], [1, 2, 3], 0, 3).nextTurn, 0);
eq("turn otherwise moves to the next seat that hasn't passed",
   G.resolveNextTurn([], [1], 0, 1).nextTurn, 2);

console.log("\nforced high card: next player is on 1 card");
const base = {
  hands: [H("5♣", "K♠"), H("9♦"), H("4♣", "6♦"), H("7♥", "8♠")],
  finished: [], passedThisTrick: [], lastPlayerSeat: null, lastPlay: null,
};
const forced = G.getForcedHighCard(base, 0);
eq("leading into a 1-card seat forces your highest card", forced && forced.rank + forced.suit, "K♠");
ok("no force when the 1-card seat isn't next",
   G.getForcedHighCard({ ...base, hands: [H("5♣", "K♠"), H("9♦", "2♣"), H("4♣"), H("7♥")] }, 0) === null);
ok("no force when a single of yours can't beat the trick anyway",
   G.getForcedHighCard({ ...base, lastPlayerSeat: 3, lastPlay: { cards: H("2♠"), seat: 3 } }, 0) === null);

console.log("\nforced high card: it is the NEXT SEAT that counts, however the trick got there");
const st = (over) => ({
  hands: [H("5♣", "K♠"), H("6♣", "7♣"), H("8♣", "9♣"), H("4♣", "4♦")],
  finished: [], passedThisTrick: [], lastPlayerSeat: null, lastPlay: null, ...over,
});
const face = (f) => f && f.rank + f.suit;
// bug: a one-card player who OWNS the trick was skipped, so the seat before
// them -- the last chance to stop them going out -- was never forced
eq("the seat before a one-card trick owner is forced (everyone between passed)",
   face(G.getForcedHighCard(st({
     hands: [H("6♣", "7♣"), H("8♣", "9♣"), H("4♣", "K♠"), H("9♦")],
     lastPlayerSeat: 3, lastPlay: { cards: H("5♦"), seat: 3 }, passedThisTrick: [0, 1],
   }), 2)), "K♠");
eq("...and a one-card owner two seats round doesn't bind the seat that isn't next to them",
   G.getForcedHighCard(st({
     hands: [H("6♣", "7♣"), H("8♣", "9♣"), H("4♣", "K♠"), H("9♦")],
     lastPlayerSeat: 3, lastPlay: { cards: H("5♦"), seat: 3 }, passedThisTrick: [],
   }), 1), null);
// bug: the player next to you had passed and was skipped, so you were forced
// because of a one-card player further round the table
eq("next seat is NOT on one card and has passed: not forced, even with a one-card seat beyond",
   G.getForcedHighCard(st({
     hands: [H("5♣", "K♠"), H("6♣", "7♣", "8♣"), H("9♦"), H("4♣", "4♦")],
     lastPlayerSeat: 3, lastPlay: { cards: H("3♦"), seat: 3 }, passedThisTrick: [1],
   }), 0), null);
eq("same table but the next seat has NOT passed: still not forced",
   G.getForcedHighCard(st({
     hands: [H("5♣", "K♠"), H("6♣", "7♣", "8♣"), H("9♦"), H("4♣", "4♦")],
     lastPlayerSeat: 3, lastPlay: { cards: H("3♦"), seat: 3 }, passedThisTrick: [],
   }), 0), null);
eq("next seat IS on one card: forced -- even though they have already passed this trick",
   face(G.getForcedHighCard(st({
     hands: [H("5♣", "K♠"), H("9♦"), H("6♣", "7♣"), H("4♣", "4♦")],
     lastPlayerSeat: 3, lastPlay: { cards: H("3♦"), seat: 3 }, passedThisTrick: [1],
   }), 0)), "K♠");
// bug: with two one-card players only the lower-numbered one was ever considered
eq("two players on one card: it is the one NEXT to you that decides",
   face(G.getForcedHighCard(st({
     hands: [H("9♦"), H("4♣", "4♦"), H("5♣", "K♠"), H("7♥")],
     lastPlayerSeat: null,
   }), 2)), "K♠");
eq("...and the other one, not next to you, does not",
   G.getForcedHighCard(st({
     hands: [H("9♦"), H("4♣", "4♦"), H("5♣", "K♠"), H("7♥", "8♥")],
     lastPlayerSeat: null,
   }), 2), null);
eq("players who are already out are skipped when finding the next seat",
   face(G.getForcedHighCard(st({
     hands: [H("5♣", "K♠"), [], H("9♦"), H("4♣", "4♦")],
     finished: [1],
   }), 0)), "K♠");
eq("answering a pair is never restricted, whoever is on one card",
   G.getForcedHighCard(st({
     hands: [H("5♣", "K♠"), H("9♦"), H("6♣", "7♣"), H("4♣", "4♦")],
     lastPlayerSeat: 3, lastPlay: { cards: H("3♦", "3♣"), seat: 3 },
   }), 0), null);
eq("nextSeatAfter wraps round the table", G.nextSeatAfter([], 3), 0);
eq("nextSeatAfter skips finished seats", G.nextSeatAfter([0, 1], 3), 2);

console.log("\nwhat the server plays when a clock runs out");
const lead1 = st({ hands: [H("3♣", "K♠"), H("9♦"), H("4♣", "5♣"), H("6♣", "7♣")] });
eq("leading into a one-card seat: the highest card (the rule applies to the timeout too)",
   face(G.autoTimeoutMove(lead1, 0)[0]), "K♠");
const lead2 = st({ hands: [H("3♣", "K♠"), H("9♦", "9♥"), H("4♣", "5♣"), H("6♣", "7♣")] });
eq("leading with nobody on one card: the lowest card, as before", face(G.autoTimeoutMove(lead2, 0)[0]), "3♣");
const resp = st({ hands: [H("5♣", "K♠"), H("9♦", "9♥"), H("4♣", "5♣"), H("6♣", "7♣")],
  lastPlayerSeat: 3, lastPlay: { cards: H("3♦"), seat: 3 } });
eq("answering with nobody on one card: pass", G.autoTimeoutMove(resp, 0), null);
const respForced = st({ hands: [H("5♣", "K♠"), H("9♦"), H("4♣", "5♣"), H("6♣", "7♣")],
  lastPlayerSeat: 3, lastPlay: { cards: H("3♦"), seat: 3 } });
eq("answering into a one-card seat: the highest card, not a pass", face(G.autoTimeoutMove(respForced, 0)[0]), "K♠");

console.log("\nseats that cannot possibly answer");
ok("one card against a pair", G.cannotBeatByCount(H("2♠"), H("8♣", "8♦")));
ok("two cards against a pair can", !G.cannotBeatByCount(H("2♠", "2♥"), H("8♣", "8♦")));
ok("four cards against a 5-card set", G.cannotBeatByCount(H("3♣", "4♣", "5♣", "6♣"), H("3♣", "4♦", "5♥", "6♠", "7♣")));
ok("five cards against a 5-card set can", !G.cannotBeatByCount(H("3♣", "4♣", "5♣", "6♣", "7♣"), H("3♣", "4♦", "5♥", "6♠", "7♣")));
ok("one card against a single can (any higher single)", !G.cannotBeatByCount(H("3♣"), H("2♠")));
ok("two cards against a triple", G.cannotBeatByCount(H("3♣", "4♣"), H("9♣", "9♦", "9♥")));
ok("no play on the table: nothing to be unable to answer", !G.cannotBeatByCount(H("3♣"), null));

console.log("\nlegs: where a seat stands in the next round");
eq("the leader is leg 1", G.legOf(2, 2), 1);
eq("the next seat is leg 2", G.legOf(3, 2), 2);
eq("counting wraps past seat 3", G.legOf(0, 2), 3);
eq("the seat just before the leader is the last leg", G.legOf(1, 2), 4);
eq("from seat 0", G.legOf(3, 0), 4);

console.log("\ndealing");
const hands = G.dealFour();
eq("four hands of 13", hands.map(h => h.length).join(","), "13,13,13,13");
eq("52 distinct cards dealt", new Set(hands.flat().map(G.cardKey)).size, 52);
ok("the player holding 3♣ starts",
   hands[G.findStartPlayer(hands)].some(x => x.rank === "3" && x.suit === "♣"));

console.log("\nownership guard — the client is untrusted");
const myHand = H("3♣", "5♦", "9♥", "9♠", "K♣");
ok("cards you hold are accepted", G.handContainsAll(myHand, H("9♥", "9♠")));
ok("a card you don't hold is rejected", !G.handContainsAll(myHand, H("2♠")));
ok("one real card plus one fake is rejected", !G.handContainsAll(myHand, H("9♥", "2♠")));
ok("the SAME card sent twice is rejected (fake unbeatable pair)",
   !G.handContainsAll(myHand, H("9♥", "9♥")));
ok("a real pair of matching ranks still works", G.handContainsAll(myHand, H("9♥", "9♠")));
ok("an empty selection is rejected", !G.handContainsAll(myHand, []));
ok("more than five cards is rejected", !G.handContainsAll(myHand, H("3♣", "5♦", "9♥", "9♠", "K♣", "3♣")));
ok("garbage input is rejected without throwing", !G.handContainsAll(myHand, [null]));
ok("a made-up rank is rejected", !G.handContainsAll(myHand, [{ rank: "99", suit: "♠" }]));
ok("a made-up suit is rejected", !G.handContainsAll(myHand, [{ rank: "9", suit: "X" }]));
ok("non-array input is rejected", !G.handContainsAll(myHand, "9♥"));

console.log("\nfuzz: trick resolution never hands the turn to a dead seat");
let fuzzBad = 0;
for (let i = 0; i < 20000; i++) {
  const owner = Math.floor(Math.random() * 4);
  const seats = [0, 1, 2, 3].filter(s => s !== owner);
  const finishedSeats = seats.filter(() => Math.random() < 0.25);
  const passed = seats.filter(s => !finishedSeats.includes(s) && Math.random() < 0.5);
  const from = Math.floor(Math.random() * 4);
  const r = G.resolveNextTurn(finishedSeats, passed, owner, from);
  if (r.reset) {
    if (r.nextTurn !== owner) fuzzBad++;                       // reset must return the lead to the owner
  } else if (finishedSeats.includes(r.nextTurn) || passed.includes(r.nextTurn)) {
    fuzzBad++;                                                  // never a seat that is out or has folded
  }
}
ok("20000 random trick states resolve to a live seat", fuzzBad === 0);

console.log("\nfuzz: every dealt hand classifies without throwing");
let throwBad = 0;
for (let i = 0; i < 2000; i++) {
  const h = G.dealFour()[0];
  for (const n of [1, 2, 3, 4, 5]) {
    const pick = [...h].sort(() => Math.random() - 0.5).slice(0, n);
    try { G.classifyCombo(pick); } catch (e) { throwBad++; }
  }
}
ok("10000 random selections classify without throwing", throwBad === 0);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
