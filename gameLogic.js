// ============================================================
// BIG2 game logic — server-authoritative version.
// Ported from the Claude-artifact prototype. Pure functions only;
// no DOM/React here. The server calls these, never the client.
// ============================================================

const SUITS = ["♣", "♦", "♥", "♠"];
const RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];

function rankIdx(r) { return RANKS.indexOf(r); }
function suitIdx(s) { return SUITS.indexOf(s); }
function cardKey(c) { return `${c.rank}${c.suit}`; }
function cardValue(c) { return rankIdx(c.rank) * 4 + suitIdx(c.suit); }

function makeDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push({ rank: r, suit: s });
  return deck;
}

function shuffle(deck) {
  const arr = [...deck];
  const crypto = require("crypto");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1); // cryptographically strong shuffle — server-side only
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dealFour() {
  const deck = shuffle(makeDeck());
  const hands = [[], [], [], []];
  for (let i = 0; i < deck.length; i++) hands[i % 4].push(deck[i]);
  hands.forEach(h => h.sort((a, b) => cardValue(a) - cardValue(b)));
  return hands;
}

function findStartPlayer(hands) {
  for (let p = 0; p < 4; p++) {
    if (hands[p].some(c => c.rank === "3" && c.suit === "♣")) return p;
  }
  return 0;
}

// Is `cards` a well-formed selection the seat actually holds? Counts copies,
// so the same card sent twice fails even though the hand contains it once —
// a client that sends [2♠,2♠] would otherwise get an unbeatable "pair".
function handContainsAll(hand, cards) {
  if (!Array.isArray(cards) || cards.length === 0 || cards.length > 5) return false;
  const pool = new Map();
  for (const c of hand) pool.set(cardKey(c), (pool.get(cardKey(c)) || 0) + 1);
  for (const c of cards) {
    if (!c || typeof c !== "object") return false;
    if (!RANKS.includes(c.rank) || !SUITS.includes(c.suit)) return false;
    const key = cardKey(c);
    const left = pool.get(key) || 0;
    if (left === 0) return false;
    pool.set(key, left - 1);
  }
  return true;
}

function classifyCombo(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const sorted = [...cards].sort((a, b) => cardValue(a) - cardValue(b));

  if (n === 1) return { type: "single", power: [0, cardValue(sorted[0])] };

  if (n === 2) {
    if (sorted[0].rank === sorted[1].rank) return { type: "pair", power: [0, cardValue(sorted[1])] };
    return null;
  }

  if (n === 3) {
    if (sorted.every(c => c.rank === sorted[0].rank)) return { type: "triple", power: [0, cardValue(sorted[2])] };
    return null;
  }

  if (n === 4) {
    if (sorted.every(c => c.rank === sorted[0].rank)) return { type: "quad", power: [0, cardValue(sorted[3])] };
    return null;
  }

  if (n === 5) {
    const ranks = sorted.map(c => c.rank);
    const suits = sorted.map(c => c.suit);
    const counts = {};
    ranks.forEach(r => (counts[r] = (counts[r] || 0) + 1));
    const countVals = Object.values(counts).sort((a, b) => b - a);
    const isFlush = suits.every(s => s === suits[0]);
    const idxs = sorted.map(c => rankIdx(c.rank)).sort((a, b) => a - b);
    let isStraight = true;
    for (let i = 1; i < idxs.length; i++) if (idxs[i] !== idxs[i - 1] + 1) { isStraight = false; break; }

    // special wrap-around straights (Thai house rule variant): A-2-3-4-5 and
    // 2-3-4-5-6. Both rank ABOVE every normal straight (max normal straight
    // is 10-J-Q-K-A); A2345 ranks above 23456; ties within the same shape
    // are broken by the suit of the 2.
    const rankSet = new Set(ranks);
    const isWrapA2345 = rankSet.size === 5 && ["A", "2", "3", "4", "5"].every(r => rankSet.has(r));
    const isWrap23456 = rankSet.size === 5 && ["2", "3", "4", "5", "6"].every(r => rankSet.has(r));

    if (countVals[0] === 4) {
      const quadRank = Object.keys(counts).find(r => counts[r] === 4);
      const quadCards = sorted.filter(c => c.rank === quadRank);
      const highQuad = Math.max(...quadCards.map(cardValue));
      return { type: "quadkick", power: [3, rankIdx(quadRank), highQuad] };
    }
    if (countVals[0] === 3 && countVals[1] === 2) {
      const tripRank = Object.keys(counts).find(r => counts[r] === 3);
      return { type: "fullhouse", power: [2, rankIdx(tripRank)] };
    }
    if (isWrapA2345 || isWrap23456) {
      const twoCard = sorted.find(c => c.rank === "2");
      const subRank = isWrapA2345 ? 13 : 12; // both above the max normal straight's idxs[4] of 11 (T-J-Q-K-A)
      if (isFlush) return { type: "straightflush", power: [4, subRank, suitIdx(twoCard.suit)] };
      return { type: "straight", power: [0, subRank, suitIdx(twoCard.suit)] };
    }
    // "2" is never part of a normal ascending run — it can only appear in a
    // straight-type combo via the two special wrap patterns above (already
    // handled). Anything else containing a 2 (e.g. J-Q-K-A-2, Q-K-A-2-3)
    // is not a straight, even though its rank indices happen to be
    // numerically consecutive under the internal ranking order.
    if (ranks.includes("2")) isStraight = false;
    if (isStraight && isFlush) return { type: "straightflush", power: [4, idxs[4], cardValue(sorted[4])] };
    if (isFlush) {
      const rankIdxsDesc = ranks.map(r => rankIdx(r)).sort((a, b) => b - a);
      return { type: "flush", power: [1, ...rankIdxsDesc, suitIdx(suits[0])] };
    }
    if (isStraight) return { type: "straight", power: [0, idxs[4], cardValue(sorted[4])] };
    return null;
  }

  return null;
}

function comboBeats(newCombo, prevCombo, newCards, prevCards) {
  if (!newCombo) return false;
  if (!prevCombo) return true;

  if (prevCards.length === 1) {
    if (newCards.length === 1) return newCombo.power[1] > prevCombo.power[1];
    if (newCards.length === 3 && newCombo.type === "triple") return true;
    return false;
  }
  if (prevCards.length === 2) {
    if (newCards.length === 2) return newCombo.power[1] > prevCombo.power[1];
    if (newCards.length === 4 && newCombo.type === "quad") return true;
    return false;
  }
  if (prevCards.length === 3) {
    if (newCards.length === 3) return newCombo.power[1] > prevCombo.power[1];
    return false;
  }
  if (prevCards.length === 4) {
    if (newCards.length === 4) return newCombo.power[1] > prevCombo.power[1];
    return false;
  }
  if (prevCards.length === 5) {
    if (newCards.length !== 5) return false;
    for (let i = 0; i < Math.max(newCombo.power.length, prevCombo.power.length); i++) {
      const a = newCombo.power[i] ?? -1;
      const b = prevCombo.power[i] ?? -1;
      if (a !== b) return a > b;
    }
    return false;
  }
  return false;
}

function handPoints(hand) {
  let pts = 0;
  hand.forEach(c => {
    if (c.rank === "2") pts += 5;
    else if (c.rank === "A") pts += 2;
    else pts += 1;
  });
  return pts;
}

function playerScore(hand) {
  const pts = handPoints(hand);
  const n = hand.length;
  if (n >= 12) return pts * 3;
  if (n >= 10) return pts * 2;
  return pts;
}

function computePayouts(hands) {
  const scores = hands.map(h => playerScore(h));
  const points = hands.map(h => handPoints(h)); // raw points, before the x2/x3 multiplier
  const net = [0, 0, 0, 0];
  const pairDetails = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const diff = scores[j] - scores[i];
      if (diff > 0) { net[i] += diff; net[j] -= diff; pairDetails.push({ from: j, to: i, amount: diff }); }
      else if (diff < 0) { net[j] += -diff; net[i] -= -diff; pairDetails.push({ from: i, to: j, amount: -diff }); }
    }
  }
  return { scores, points, net, pairDetails };
}

function trickShouldReset(finishedSeats, passedThisTrick, ownerSeat) {
  for (let s = 0; s < 4; s++) {
    if (s === ownerSeat) continue;
    if (finishedSeats.includes(s)) continue;
    if (passedThisTrick.includes(s)) continue;
    return false;
  }
  return true;
}

function resolveNextTurn(finishedSeats, passedThisTrick, ownerSeat, fromSeat) {
  if (trickShouldReset(finishedSeats, passedThisTrick, ownerSeat)) return { reset: true, nextTurn: ownerSeat };
  let s = (fromSeat + 1) % 4;
  let guard = 0;
  while ((s === ownerSeat || passedThisTrick.includes(s) || finishedSeats.includes(s)) && guard < 4) {
    s = (s + 1) % 4;
    guard++;
  }
  return { reset: false, nextTurn: s };
}

function highestCard(hand) {
  return hand.reduce((best, c) => (cardValue(c) > cardValue(best) ? c : best), hand[0]);
}

// The seat that acts after `seat`: the next chair round the table, skipping
// only players who are already out of the round. Deliberately NOT the same as
// resolveNextTurn, which also skips whoever has passed in this trick and
// whoever owns it -- that answers "who plays next", and the last-card rule is
// about who is sitting next to you.
function nextSeatAfter(finishedSeats, seat) {
  for (let i = 1; i <= 4; i++) {
    const s = (seat + i) % 4;
    if (!(finishedSeats || []).includes(s)) return s;
  }
  return seat;
}

// BIG2 rule: if the seat next to you has exactly 1 card left and you choose to
// play/lead a SINGLE, it must be your highest card. Choosing a pair / triple /
// 5-set instead is always unrestricted.
//
// "Next to you" means the next chair -- whether that player has already passed
// in this trick, or owns it, makes no difference. Two things follow:
//   * a one-card player further round the table does not bind you if the
//     player next to you is not on one card (even if that player has passed)
//   * a one-card player who owns the current trick does bind the seat before
//     them: that seat is the last chance to stop them going out
function getForcedHighCard(state, actingSeat) {
  const hand = state.hands[actingSeat];
  if (!hand || hand.length === 0) return null;
  const nextSeat = nextSeatAfter(state.finished, actingSeat);
  if (nextSeat === actingSeat) return null;
  const nextHand = state.hands[nextSeat];
  if (!nextHand || nextHand.length !== 1) return null;

  const myHighest = highestCard(hand);
  const isLeading = state.lastPlayerSeat === null;
  if (!isLeading) {
    // answering a trick: only singles are affected, and only if your highest
    // card can actually beat the one on the table
    if (!state.lastPlay || state.lastPlay.cards.length !== 1) return null;
    if (cardValue(myHighest) <= cardValue(state.lastPlay.cards[0])) return null;
  }
  return myHighest;
}

// What the server plays for a seat whose clock ran out. It has to obey the
// last-card rule too -- it used to lead the lowest card without looking, which
// handed a one-card player an easy way out.
function autoTimeoutMove(state, seat) {
  const forced = getForcedHighCard(state, seat);
  if (forced) return [forced];
  const leading = state.lastPlayerSeat === null || state.lastPlayerSeat === seat;
  if (!leading) return null; // pass
  const lowest = [...state.hands[seat]].sort((a, b) => cardValue(a) - cardValue(b))[0];
  return lowest ? [lowest] : null;
}

// True when the seat cannot possibly answer the trick because it holds fewer
// cards than the play on the table. Every answer needs at least as many cards
// as the play it beats (a single is beaten by 1 or 3, a pair by 2 or 4, a
// triple by 3, a quad by 4, a 5-card set by 5), so this is exact -- no card
// looking involved, and it never takes a play away from anyone.
function cannotBeatByCount(hand, lastPlayCards) {
  if (!hand || !lastPlayCards || lastPlayCards.length === 0) return false;
  return hand.length < lastPlayCards.length;
}

// Where a seat stands in the next round's turn order, counted from the leader
// (who is always last round's winner): 1 = leads, 4 = the last leg.
function legOf(seat, leaderSeat) {
  return ((seat - leaderSeat + 4) % 4) + 1;
}

function drawSeatCards() {
  const deck = shuffle(makeDeck());
  return [0, 1, 2, 3].map(i => deck[i]);
}

function seatDrawOrder(cards) {
  return [0, 1, 2, 3].sort((a, b) => cardValue(cards[b]) - cardValue(cards[a]));
}

function fillRemainingSeats(seat1, seat2) {
  const remaining = [0, 1, 2, 3].filter(s => s !== seat1 && s !== seat2);
  remaining.sort((a, b) => ((a - seat2 + 4) % 4) - ((b - seat2 + 4) % 4));
  return remaining;
}

function find5CardCombos(hand) {
  const combos = [];
  const bySuit = {};
  const byRank = {};
  hand.forEach(c => {
    (bySuit[c.suit] ||= []).push(c);
    (byRank[c.rank] ||= []).push(c);
  });

  // straights (and straight flushes, when a same-suit run exists)
  for (let start = 0; start <= RANKS.length - 5; start++) {
    const neededRanks = RANKS.slice(start, start + 5);
    if (neededRanks.every(r => byRank[r] && byRank[r].length > 0)) {
      let sfCards = null;
      for (const suit of SUITS) {
        const cards = neededRanks.map(r => byRank[r].find(c => c.suit === suit));
        if (cards.every(Boolean)) { sfCards = cards; break; }
      }
      if (sfCards) combos.push({ cards: sfCards, combo: classifyCombo(sfCards) });
      const cards = neededRanks.map(r => byRank[r][0]);
      combos.push({ cards, combo: classifyCombo(cards) });
    }
  }

  // wrap-around straights: A-2-3-4-5 and 2-3-4-5-6 (not reachable via the
  // consecutive-window scan above, since RANKS puts 2 at the very end)
  [["A", "2", "3", "4", "5"], ["2", "3", "4", "5", "6"]].forEach(neededRanks => {
    if (neededRanks.every(r => byRank[r] && byRank[r].length > 0)) {
      let sfCards = null;
      for (const suit of SUITS) {
        const cards = neededRanks.map(r => byRank[r].find(c => c.suit === suit));
        if (cards.every(Boolean)) { sfCards = cards; break; }
      }
      if (sfCards) combos.push({ cards: sfCards, combo: classifyCombo(sfCards) });
      const cards = neededRanks.map(r => byRank[r][0]);
      combos.push({ cards, combo: classifyCombo(cards) });
    }
  });

  // flushes — offer both the cheapest 5 and the strongest 5 of a suit
  Object.values(bySuit).forEach(cards => {
    if (cards.length >= 5) {
      const sorted = [...cards].sort((a, b) => cardValue(a) - cardValue(b));
      combos.push({ cards: sorted.slice(0, 5), combo: classifyCombo(sorted.slice(0, 5)) });
      if (sorted.length > 5) combos.push({ cards: sorted.slice(-5), combo: classifyCombo(sorted.slice(-5)) });
    }
  });

  // full house (triple + pair)
  Object.entries(byRank).filter(([, cs]) => cs.length >= 3).forEach(([tr, tcs]) => {
    Object.entries(byRank).filter(([r, cs]) => cs.length >= 2 && r !== tr).forEach(([, pcs]) => {
      const cards = [...tcs.slice(0, 3), ...pcs.slice(0, 2)];
      combos.push({ cards, combo: classifyCombo(cards) });
    });
  });

  // four of a kind + kicker
  Object.entries(byRank).filter(([, cs]) => cs.length === 4).forEach(([qr, qcs]) => {
    hand.forEach(k => {
      if (k.rank === qr) return;
      const cards = [...qcs, k];
      combos.push({ cards, combo: classifyCombo(cards) });
    });
  });

  return combos.filter(c => c.combo);
}

module.exports = {
  SUITS, RANKS,
  cardKey, cardValue, makeDeck, shuffle, dealFour, findStartPlayer,
  handContainsAll, classifyCombo, comboBeats, handPoints, playerScore, computePayouts,
  trickShouldReset, resolveNextTurn, nextSeatAfter, highestCard, getForcedHighCard,
  autoTimeoutMove, cannotBeatByCount, legOf,
  drawSeatCards, seatDrawOrder, fillRemainingSeats,
  find5CardCombos,
};
