var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
const { useState, useEffect, useRef, useCallback } = React;
const SUIT_COLOR = { "\u2663": "#1b5540", "\u2666": "#c0392b", "\u2665": "#c0392b", "\u2660": "#111111" };
const SEAT_COLORS = ["#ff5252", "#29b6f6", "#ff9800", "#4caf50"];
const COMBO_LABEL = { single: "\u0E43\u0E1A\u0E40\u0E14\u0E35\u0E22\u0E27", pair: "\u0E04\u0E39\u0E48", triple: "\u0E15\u0E2D\u0E07", quad: "\u0E04\u0E27\u0E2D\u0E14", straight: "\u0E40\u0E23\u0E35\u0E22\u0E07", flush: "\u0E1F\u0E25\u0E31\u0E0A", fullhouse: "\u0E1F\u0E39\u0E25\u0E40\u0E2E\u0E32\u0E2A\u0E4C", quadkick: "\u0E04\u0E27\u0E2D\u0E14\u0E04\u0E35\u0E1A", straightflush: "\u0E2A\u0E40\u0E15\u0E23\u0E17\u0E1F\u0E25\u0E31\u0E0A" };
function cardKey(c) {
  return `${c.rank}${c.suit}`;
}
function handPoints(hand) {
  let pts = 0;
  (hand || []).forEach((c) => {
    if (c.rank === "2") pts += 5;
    else if (c.rank === "A") pts += 2;
    else pts += 1;
  });
  return pts;
}
function PlayingCard({ card, selected, onClick, small, large, style }) {
  const w = large ? 68 : small ? 40 : 58, h = large ? 100 : small ? 58 : 82;
  const rankSize = large ? 20 : small ? 14 : 18, suitBig = large ? 30 : small ? 18 : 27;
  const color = SUIT_COLOR[card.suit];
  return /* @__PURE__ */ React.createElement("div", { onClick, style: __spreadValues({
    width: w,
    height: h,
    borderRadius: small ? 6 : 10,
    background: "#fdfcf7",
    border: selected ? "2px solid #d4af37" : "1px solid #ccc",
    boxShadow: selected ? "0 -8px 14px -4px rgba(212,175,55,.55), 0 3px 6px rgba(0,0,0,.35)" : "0 2px 5px rgba(0,0,0,.35)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: small ? "3px 4px" : "5px 6px",
    userSelect: "none",
    flexShrink: 0,
    cursor: onClick ? "pointer" : "default"
  }, style) }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: rankSize, fontWeight: 800, color, lineHeight: 1 } }, card.rank, /* @__PURE__ */ React.createElement("div", { style: { fontSize: rankSize * 0.8, fontWeight: 700 } }, card.suit)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: suitBig, color, textAlign: "center", fontWeight: 700 } }, card.suit));
}
function Hand({ cards, selected, onToggle }) {
  const ref = useRef(null);
  const [w, setW] = useState(360);
  const [order, setOrder] = useState(() => cards.map(cardKey));
  const [dragKey, setDragKey] = useState(null);
  const [dragX, setDragX] = useState(0);
  const dragInfo = useRef({ startClientX: 0, startLeft: 0, moved: false });
  useEffect(() => {
    function measure() {
      if (ref.current) setW(ref.current.offsetWidth || 360);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const cardsSignature = cards.map(cardKey).join(",");
  useEffect(() => {
    const keys = cards.map(cardKey);
    setOrder((prev) => {
      const kept = prev.filter((k) => keys.includes(k));
      const added = keys.filter((k) => !kept.includes(k));
      return [...kept, ...added];
    });
  }, [cardsSignature]);
  const CARD_W = 68;
  const orderedCards = order.map((k) => cards.find((c) => cardKey(c) === k)).filter(Boolean);
  const n = orderedCards.length;
  const gap = n > 1 ? Math.min(CARD_W * 0.66, Math.max(14, (w - CARD_W) / (n - 1))) : 0;
  const totalW = n > 0 ? gap * (n - 1) + CARD_W : CARD_W;
  const center = (n - 1) / 2;
  function handlePointerDown(e, key) {
    const idx = order.indexOf(key);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragKey(key);
    dragInfo.current = { startClientX: e.clientX, startLeft: idx * gap, moved: false };
  }
  function handlePointerMove(e) {
    if (!dragKey) return;
    const deltaX = e.clientX - dragInfo.current.startClientX;
    if (Math.abs(deltaX) > 5) dragInfo.current.moved = true;
    setDragX(deltaX);
    const targetLeft = dragInfo.current.startLeft + deltaX;
    let targetIndex = Math.round(targetLeft / (gap || 1));
    targetIndex = Math.max(0, Math.min(n - 1, targetIndex));
    const currentIndex = order.indexOf(dragKey);
    if (targetIndex !== currentIndex) {
      setOrder((prev) => {
        const next = [...prev];
        next.splice(currentIndex, 1);
        next.splice(targetIndex, 0, dragKey);
        return next;
      });
    }
  }
  function handlePointerUp(e, key, card) {
    const wasDrag = dragInfo.current.moved;
    setDragKey(null);
    setDragX(0);
    if (!wasDrag) onToggle(card);
  }
  return /* @__PURE__ */ React.createElement("div", { ref, style: { position: "relative", height: 118, width: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", height: 118, width: totalW, margin: "0 auto" } }, orderedCards.map((c, i) => {
    const key = cardKey(c);
    const isDragging = key === dragKey;
    const isSel = selected.some((s) => cardKey(s) === key);
    const baseLeft = i * gap;
    const left = isDragging ? dragInfo.current.startLeft + dragX : baseLeft;
    const tilt = (i - center) * (gap < 30 ? 1.1 : 1.6);
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key,
        onPointerDown: (e) => handlePointerDown(e, key),
        onPointerMove: handlePointerMove,
        onPointerUp: (e) => handlePointerUp(e, key, c),
        onPointerCancel: () => {
          setDragKey(null);
          setDragX(0);
        },
        style: {
          position: "absolute",
          left,
          top: isDragging ? 0 : isSel ? -14 : 0,
          transform: isDragging ? "scale(1.06)" : `rotate(${tilt}deg)`,
          transition: isDragging ? "none" : "left .18s, top .18s, transform .18s",
          zIndex: isDragging ? 50 : isSel ? 30 + i : i,
          touchAction: "none"
        }
      },
      /* @__PURE__ */ React.createElement(PlayingCard, { card: c, large: true, selected: isSel && !isDragging, style: isDragging ? { boxShadow: "0 10px 18px rgba(0,0,0,.5)" } : void 0 })
    );
  })));
}
function TrickPile({ trickPile }) {
  if (!trickPile || trickPile.length === 0) return /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(244,233,216,.35)", fontSize: 12 } }, "\u0E42\u0E15\u0E4A\u0E30");
  const n = trickPile.length, maxX = 40, maxY = 22;
  const stepX = n > 1 ? maxX / (n - 1) : 0, stepY = n > 1 ? maxY / (n - 1) : 0;
  return /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" } }, trickPile.map((entry, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: {
    position: "absolute",
    left: i * stepX - maxX / 2,
    top: maxY / 2 - i * stepY,
    transform: "translate(-50%,-50%)",
    zIndex: i,
    display: "flex",
    gap: 2,
    filter: i < n - 1 ? "brightness(0.8)" : "none"
  } }, entry.cards.map((c) => /* @__PURE__ */ React.createElement(PlayingCard, { key: cardKey(c), card: c, small: true })))));
}
function Table({ mySeat, players, handCounts, turn, trickPile, finished, passedThisTrick, cumulative, turnStartedAt, turnSeconds }) {
  const others = [1, 2, 3].map((o) => (mySeat + o) % 4);
  function posKey(seat) {
    const off = (seat - mySeat + 4) % 4;
    return off === 1 ? "left" : off === 2 ? "top" : "right";
  }
  const bySeat = {};
  others.forEach((s) => bySeat[posKey(s)] = s);
  function Seat({ seat }) {
    const active = turn === seat, passed = (passedThisTrick || []).includes(seat), big2 = handCounts[seat] === 1;
    const color = passed ? "#6b6b6b" : SEAT_COLORS[seat];
    const score = cumulative ? cumulative[seat] : 0;
    const inner = /* @__PURE__ */ React.createElement("div", { style: {
      textAlign: "center",
      padding: "8px 12px",
      borderRadius: 12,
      minWidth: 64,
      background: "linear-gradient(180deg, rgba(20,32,54,.92), rgba(14,24,44,.92))",
      border: active ? "none" : `2px solid ${color}`,
      boxShadow: active ? "none" : "0 2px 6px rgba(0,0,0,.3)"
    } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#f4e9d8", fontWeight: 700 } }, players[seat] || `\u0E1A\u0E2D\u0E17 ${seat + 1}`, finished.includes(seat) && " \u2705"), big2 ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 900, color: "#ff5252" } }, "BIG2! \u{1F525}") : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: active ? "#d4af37" : "#8a9a8e" } }, passed ? "\u0E1C\u0E48\u0E32\u0E19" : `${handCounts[seat]} \u0E43\u0E1A`), cumulative && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: score >= 0 ? "#6fbf8a" : "#e08a8a" } }, score >= 0 ? "+" : "", score));
    if (!active) return inner;
    const elapsed = turnStartedAt ? Date.now() - turnStartedAt : 0;
    const elapsedFrac = Math.max(0, Math.min(1, elapsed / ((turnSeconds || 30) * 1e3)));
    const deg = elapsedFrac * 360;
    return /* @__PURE__ */ React.createElement("div", { style: {
      padding: 3,
      borderRadius: 14,
      background: `conic-gradient(rgba(255,255,255,.18) ${deg}deg, ${color} ${deg}deg)`,
      boxShadow: `0 0 12px ${color}99`
    } }, inner);
  }
  return /* @__PURE__ */ React.createElement("div", { style: { width: "100%", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center", marginBottom: 10 } }, /* @__PURE__ */ React.createElement(Seat, { seat: bySeat.top })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement(Seat, { seat: bySeat.left }), /* @__PURE__ */ React.createElement("div", { style: {
    position: "relative",
    flex: 1,
    minHeight: 170,
    borderRadius: "50%",
    background: "radial-gradient(ellipse at center, #2e9b5f 0%, #1c7a45 60%, #0f4d2c 100%)",
    border: "9px solid #2b2b2e",
    boxShadow: "inset 0 0 0 5px #1a1a1c, inset 0 0 28px rgba(0,0,0,.5), 0 6px 16px rgba(0,0,0,.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  } }, /* @__PURE__ */ React.createElement(TrickPile, { trickPile })), /* @__PURE__ */ React.createElement(Seat, { seat: bySeat.right })));
}
const styles = {
  bg: { minHeight: "100vh", width: "100%", background: "radial-gradient(ellipse at center, #1e4a7a 0%, #0d2848 70%, #061428 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { background: "rgba(10,20,40,0.6)", border: "1px solid #2f5f8f", borderRadius: 16, padding: "28px 24px", width: "100%", maxWidth: 380, boxShadow: "0 8px 32px rgba(0,0,0,.5)" },
  input: { width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #3a5a7f", background: "#0f1f3a", color: "#f4e9d8", fontSize: 15, marginBottom: 10, boxSizing: "border-box" },
  goldBtn: { width: "100%", padding: "12px 14px", borderRadius: 8, border: "none", background: "linear-gradient(180deg,#e6c565,#c9a03e)", color: "#1a1a1a", fontWeight: 700, fontSize: 15, marginBottom: 6 },
  greenBtn: { width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #3a5a7f", background: "transparent", color: "#f4e9d8", fontWeight: 600, fontSize: 15 },
  wrap: { width: "100%", maxWidth: 720 },
  statBox: { flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 14, background: "linear-gradient(180deg, rgba(212,175,55,.14), rgba(212,175,55,.04))", border: "1.5px solid #d4af37" },
  matchBadge: { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", borderRadius: 20, border: "1px solid #8a9a8e", color: "#c9d4cb", fontSize: 11, fontWeight: 600, cursor: "pointer", background: "rgba(255,255,255,.05)" },
  matchBadgeActive: { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", borderRadius: 20, border: "1px solid #ff9800", color: "#ff9800", fontSize: 12, fontWeight: 800, background: "rgba(255,152,0,.12)", boxShadow: "0 0 8px rgba(255,152,0,.3)" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1e3, padding: 16 },
  modalCard: { background: "#0f1f3a", border: "1px solid #2f5f8f", borderRadius: 16, padding: "22px 18px", width: "100%", maxWidth: 380, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,.5)" }
};
function HistoryModal({ roundHistory, players, mySeat, cumulative, onClose }) {
  const [viewRound, setViewRound] = useState(null);
  function valueFor(row, colSeat) {
    const colName = players[colSeat];
    if (!row.players || colName === null) return row.net[colSeat];
    const idx = row.players.indexOf(colName);
    return idx === -1 ? null : row.net[idx];
  }
  return /* @__PURE__ */ React.createElement("div", { style: styles.modalOverlay, onClick: onClose }, /* @__PURE__ */ React.createElement("div", { style: styles.modalCard, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("h2", { style: { color: "#d4af37", textAlign: "center", marginBottom: 12 } }, "\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34\u0E04\u0E30\u0E41\u0E19\u0E19"), !roundHistory || roundHistory.length === 0 ? /* @__PURE__ */ React.createElement("p", { style: { color: "#8a9a8e", textAlign: "center" } }, "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E2D\u0E1A\u0E17\u0E35\u0E48\u0E08\u0E1A\u0E04\u0E23\u0E31\u0E1A") : /* @__PURE__ */ React.createElement("div", { style: { overflowX: "auto" } }, /* @__PURE__ */ React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { color: "#8a9a8e", padding: "4px 8px", textAlign: "center", borderBottom: "1px solid #2f5f8f" } }, "\u0E23\u0E2D\u0E1A"), [0, 1, 2, 3].map((s) => /* @__PURE__ */ React.createElement("th", { key: s, style: { color: "#8a9a8e", padding: "4px 8px", textAlign: "center", borderBottom: "1px solid #2f5f8f", whiteSpace: "nowrap" } }, s === mySeat ? "\u0E04\u0E38\u0E13" : players[s] || `\u0E1A\u0E2D\u0E17 ${s + 1}`)), /* @__PURE__ */ React.createElement("th", { style: { color: "#8a9a8e", padding: "4px 8px", textAlign: "center", borderBottom: "1px solid #2f5f8f" } }))), /* @__PURE__ */ React.createElement("tbody", null, roundHistory.map((r) => /* @__PURE__ */ React.createElement("tr", { key: r.round }, /* @__PURE__ */ React.createElement("td", { style: { color: "#f4e9d8", padding: "4px 8px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.05)" } }, r.round), [0, 1, 2, 3].map((s) => {
    const v = valueFor(r, s);
    return /* @__PURE__ */ React.createElement("td", { key: s, style: { padding: "4px 8px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.05)", color: v === null ? "#5a7a9f" : v >= 0 ? "#6fbf8a" : "#e08a8a" } }, v === null ? "\u2014" : `${v >= 0 ? "+" : ""}${v}`);
  }), /* @__PURE__ */ React.createElement("td", { style: { padding: "4px 6px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.05)" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setViewRound(r), style: { padding: "3px 8px", borderRadius: 6, border: "1px solid #d4af37", background: "transparent", color: "#d4af37", fontSize: 10, cursor: "pointer", whiteSpace: "nowrap" } }, "\u0E2A\u0E23\u0E38\u0E1B")))), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { style: { color: "#d4af37", fontWeight: 700, padding: "4px 8px", textAlign: "center" } }, "\u0E23\u0E27\u0E21"), cumulative.map((v, s) => /* @__PURE__ */ React.createElement("td", { key: s, style: { color: v >= 0 ? "#6fbf8a" : "#e08a8a", fontWeight: 700, padding: "4px 8px", textAlign: "center" } }, v >= 0 ? "+" : "", v)), /* @__PURE__ */ React.createElement("td", null))))), /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.goldBtn), { marginTop: 16 }), onClick: onClose }, "\u0E1B\u0E34\u0E14")), viewRound && /* @__PURE__ */ React.createElement("div", { style: __spreadProps(__spreadValues({}, styles.modalOverlay), { zIndex: 1200 }), onClick: (e) => {
    e.stopPropagation();
    setViewRound(null);
  } }, /* @__PURE__ */ React.createElement("div", { style: styles.modalCard, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("h2", { style: { color: "#d4af37", textAlign: "center", marginBottom: 12 } }, "\u0E2A\u0E23\u0E38\u0E1B\u0E23\u0E2D\u0E1A\u0E17\u0E35\u0E48 ", viewRound.round), [0, 1, 2, 3].map((s) => {
    const nm = viewRound.players && viewRound.players[s] || players[s] || `\u0E1A\u0E2D\u0E17 ${s + 1}`;
    const cardsLeft = viewRound.cardsLeft[s];
    const score = viewRound.scores[s];
    const net = viewRound.net[s];
    const mult = cardsLeft >= 12 ? 3 : cardsLeft >= 10 ? 2 : 1;
    const isWinner = cardsLeft === 0;
    const hand = viewRound.hands ? viewRound.hands[s] : [];
    return /* @__PURE__ */ React.createElement("div", { key: s, style: { padding: "8px 10px", marginBottom: 6, borderRadius: 8, background: "rgba(255,255,255,.05)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: hand.length > 0 ? 6 : 0 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#f4e9d8", fontSize: 13, fontWeight: 600 } }, nm, isWinner && " \u{1F3C6}"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#8a9a8e", textAlign: "center" } }, isWinner ? "\u0E0A\u0E19\u0E30" : `\u0E40\u0E2B\u0E25\u0E37\u0E2D ${cardsLeft} \u0E43\u0E1A \xB7 ${score} pt${mult > 1 ? ` (x${mult})` : ""}`), /* @__PURE__ */ React.createElement("span", { style: { color: net >= 0 ? "#6fbf8a" : "#e08a8a", fontWeight: 700, fontSize: 13 } }, net >= 0 ? "+" : "", net)), hand.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "center" } }, hand.map((c) => /* @__PURE__ */ React.createElement(PlayingCard, { key: cardKey(c), card: c, small: true }))));
  }), /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.goldBtn), { marginTop: 12 }), onClick: () => setViewRound(null) }, "\u0E1B\u0E34\u0E14"))));
}
function ChatPanel({ chat, chatInput, setChatInput, sendChat, mySeat }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(false);
  const listRef = useRef(null);
  const prevLenRef = useRef(chat.length);
  useEffect(() => {
    if (chat.length > prevLenRef.current && !openRef.current) setUnread((u) => u + (chat.length - prevLenRef.current));
    prevLenRef.current = chat.length;
    if (openRef.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [chat]);
  function toggle() {
    const next = !open;
    openRef.current = next;
    setOpen(next);
    if (next) setUnread(0);
  }
  const lastMsg = chat.length ? chat[chat.length - 1] : null;
  return /* @__PURE__ */ React.createElement("div", { style: { position: "relative", marginTop: 10 } }, open && /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    bottom: "calc(100% + 6px)",
    left: 0,
    right: 0,
    zIndex: 200,
    background: "#0f1f3a",
    border: "1px solid #2f5f8f",
    borderRadius: 12,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 8px 24px rgba(0,0,0,.5)"
  } }, /* @__PURE__ */ React.createElement("div", { ref: listRef, style: { height: 160, overflowY: "auto", padding: "8px 10px" } }, chat.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { color: "#5a7a9f", fontSize: 11, textAlign: "center", marginTop: 14 } }, "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21"), chat.map((m, i) => {
    const mine = m.seat === mySeat;
    return /* @__PURE__ */ React.createElement("div", { key: i, style: { marginBottom: 6, textAlign: mine ? "right" : "left" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: SEAT_COLORS[m.seat] || "#8a9a8e", fontWeight: 700, marginBottom: 1 } }, m.name), /* @__PURE__ */ React.createElement("span", { style: {
      display: "inline-block",
      maxWidth: "85%",
      padding: "5px 9px",
      borderRadius: 10,
      fontSize: 12,
      background: mine ? "#d4af37" : "rgba(255,255,255,.08)",
      color: mine ? "#1a1a1a" : "#f4e9d8",
      wordBreak: "break-word",
      textAlign: "left"
    } }, m.text));
  })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, padding: 6, borderTop: "1px solid #2f5f8f" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: chatInput,
      onChange: (e) => setChatInput(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter") sendChat();
      },
      placeholder: "\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21...",
      maxLength: 200,
      style: { flex: 1, padding: "7px 10px", borderRadius: 8, border: "1px solid #3a5a7f", background: "#132747", color: "#f4e9d8", fontSize: 12 }
    }
  ), /* @__PURE__ */ React.createElement("button", { onClick: sendChat, style: { padding: "7px 12px", borderRadius: 8, border: "none", background: "#d4af37", color: "#1a1a1a", fontWeight: 700, fontSize: 12 } }, "\u0E2A\u0E48\u0E07"))), /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: toggle,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 10,
        background: "#0f1f3a",
        border: "1px solid #2f5f8f",
        cursor: "pointer"
      }
    },
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 16 } }, "\u{1F4AC}"),
    /* @__PURE__ */ React.createElement("span", { style: { flex: 1, fontSize: 12, color: lastMsg ? "#f4e9d8" : "#5a7a9f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, lastMsg ? `${lastMsg.name}: ${lastMsg.text}` : "\u0E41\u0E15\u0E30\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E41\u0E0A\u0E17..."),
    unread > 0 && /* @__PURE__ */ React.createElement("span", { style: {
      background: "#e63946",
      color: "#fff",
      fontSize: 10,
      fontWeight: 800,
      borderRadius: "50%",
      minWidth: 18,
      height: 18,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 4px"
    } }, unread > 9 ? "9+" : unread),
    /* @__PURE__ */ React.createElement("span", { style: { color: "#8a9a8e", fontSize: 11 } }, open ? "\u25BC" : "\u25B2")
  ));
}
function App() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [screen, setScreen] = useState("lobby");
  const [state, setState] = useState(null);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");
  const [, tick] = useState(0);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      try {
        const saved = JSON.parse(localStorage.getItem("big2session") || "null");
        if (saved && saved.name && saved.code) {
          setName(saved.name);
          setRoomCode(saved.code);
          joinRoom(saved.name, saved.code);
        }
      } catch (e) {
      }
    });
    socket.on("state", (s) => {
      setState(s);
      setScreen("room");
    });
    socket.on("actionError", (msg) => setError(msg));
    socket.on("chatHistory", (msgs) => setChat(msgs));
    socket.on("chatMessage", (msg) => setChat((prev) => [...prev, msg]));
    return () => socket.disconnect();
  }, []);
  useEffect(() => {
    if (!state || state.phase !== "playing") return;
    const iv = setInterval(() => tick((t) => t + 1), 250);
    return () => clearInterval(iv);
  }, [state == null ? void 0 : state.turn, state == null ? void 0 : state.phase]);
  function createRoom() {
    if (!name.trim()) {
      setError("\u0E43\u0E2A\u0E48\u0E0A\u0E37\u0E48\u0E2D\u0E01\u0E48\u0E2D\u0E19\u0E04\u0E23\u0E31\u0E1A");
      return;
    }
    socketRef.current.emit("createRoom", { name }, (res) => {
      if (!res.ok) setError(res.error || "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2B\u0E49\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
      else {
        setRoomCode(res.code);
        localStorage.setItem("big2session", JSON.stringify({ name: name.trim(), code: res.code }));
      }
    });
  }
  function joinRoom(overrideName, overrideCode) {
    const n = (overrideName != null ? overrideName : name).trim();
    const c = (overrideCode != null ? overrideCode : roomCode).trim().toUpperCase();
    if (!n || !c) {
      setError("\u0E43\u0E2A\u0E48\u0E0A\u0E37\u0E48\u0E2D\u0E41\u0E25\u0E30\u0E23\u0E2B\u0E31\u0E2A\u0E2B\u0E49\u0E2D\u0E07\u0E01\u0E48\u0E2D\u0E19\u0E04\u0E23\u0E31\u0E1A");
      return;
    }
    socketRef.current.emit("joinRoom", { name: n, code: c }, (res) => {
      if (!res.ok) {
        setError(res.error || "\u0E40\u0E02\u0E49\u0E32\u0E2B\u0E49\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
        localStorage.removeItem("big2session");
      } else {
        localStorage.setItem("big2session", JSON.stringify({ name: n, code: c }));
      }
    });
  }
  function startGame() {
    socketRef.current.emit("startGame", { code: state.code });
  }
  function playSelected(override) {
    const cards = override || selected;
    if (cards.length === 0) return;
    socketRef.current.emit("playCards", { code: state.code, cards });
    setSelected([]);
  }
  function passTurn() {
    socketRef.current.emit("pass", { code: state.code });
  }
  function startLastRounds() {
    socketRef.current.emit("startLastRounds", { code: state.code });
  }
  function restartMatch() {
    socketRef.current.emit("restartMatch", { code: state.code });
  }
  function leaveRoom() {
    localStorage.removeItem("big2session");
    window.location.reload();
  }
  function sendChat() {
    if (!chatInput.trim() || !state) return;
    socketRef.current.emit("chatMessage", { code: state.code, text: chatInput });
    setChatInput("");
  }
  function toggleSelect(c) {
    const k = cardKey(c);
    setSelected((prev) => prev.some((s) => cardKey(s) === k) ? prev.filter((s) => cardKey(s) !== k) : [...prev, c]);
  }
  if (screen === "lobby") {
    return /* @__PURE__ */ React.createElement("div", { style: styles.bg }, /* @__PURE__ */ React.createElement("div", { style: styles.card }, /* @__PURE__ */ React.createElement("h1", { style: { color: "#d4af37", textAlign: "center", fontSize: 36, letterSpacing: 4 } }, "BIG 2"), /* @__PURE__ */ React.createElement("p", { style: { color: "#8a9a8e", textAlign: "center", fontSize: 13, marginBottom: 20 } }, connected ? "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E41\u0E25\u0E49\u0E27 \u2014 \u0E40\u0E25\u0E48\u0E19\u0E44\u0E14\u0E49\u0E41\u0E1A\u0E1A\u0E44\u0E21\u0E48\u0E14\u0E35\u0E40\u0E25\u0E22\u0E4C" : "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D..."), /* @__PURE__ */ React.createElement("input", { style: styles.input, placeholder: "\u0E0A\u0E37\u0E48\u0E2D\u0E02\u0E2D\u0E07\u0E04\u0E38\u0E13", value: name, onChange: (e) => setName(e.target.value) }), /* @__PURE__ */ React.createElement("button", { style: styles.goldBtn, onClick: createRoom }, "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2B\u0E49\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48"), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", color: "#5a7a9f", fontSize: 12, margin: "14px 0" } }, "\u0E2B\u0E23\u0E37\u0E2D"), /* @__PURE__ */ React.createElement("input", { style: styles.input, placeholder: "\u0E23\u0E2B\u0E31\u0E2A\u0E2B\u0E49\u0E2D\u0E07", value: roomCode, onChange: (e) => setRoomCode(e.target.value.toUpperCase()), maxLength: 4 }), /* @__PURE__ */ React.createElement("button", { style: styles.greenBtn, onClick: joinRoom }, "\u0E40\u0E02\u0E49\u0E32\u0E23\u0E48\u0E27\u0E21\u0E2B\u0E49\u0E2D\u0E07"), error && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, color: "#e08a8a", fontSize: 12, textAlign: "center" } }, error)));
  }
  if (!state) return /* @__PURE__ */ React.createElement("div", { style: styles.bg }, /* @__PURE__ */ React.createElement("div", { style: styles.card }, /* @__PURE__ */ React.createElement("p", { style: { color: "#fff" } }, "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14...")));
  if (state.phase === "waiting") {
    return /* @__PURE__ */ React.createElement("div", { style: styles.bg }, /* @__PURE__ */ React.createElement("div", { style: styles.card }, /* @__PURE__ */ React.createElement("h2", { style: { color: "#f4e9d8", textAlign: "center" } }, "\u0E2B\u0E49\u0E2D\u0E07 ", state.code), /* @__PURE__ */ React.createElement("p", { style: { color: "#d4af37", fontSize: 13, textAlign: "center", marginBottom: 16 } }, '\u0E2A\u0E48\u0E07\u0E23\u0E2B\u0E31\u0E2A\u0E19\u0E35\u0E49\u0E43\u0E2B\u0E49\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E19 \u0E41\u0E25\u0E49\u0E27\u0E01\u0E14 "\u0E40\u0E02\u0E49\u0E32\u0E23\u0E48\u0E27\u0E21\u0E2B\u0E49\u0E2D\u0E07"'), [0, 1, 2, 3].map((i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,.05)", borderRadius: 6, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#f4e9d8" } }, "\u0E17\u0E35\u0E48\u0E19\u0E31\u0E48\u0E07 ", i + 1), /* @__PURE__ */ React.createElement("span", { style: { color: state.players[i] ? "#d4af37" : "#8a9a8e" } }, state.players[i] || (i === state.mySeat ? "\u0E04\u0E38\u0E13" : "\u0E27\u0E48\u0E32\u0E07 (\u0E1A\u0E2D\u0E17)")))), state.mySeat === 0 && (state.matchRoundsRemaining !== null ? /* @__PURE__ */ React.createElement("p", { style: { color: "#d4af37", textAlign: "center", fontSize: 12, marginTop: 10 } }, "\u0E42\u0E2B\u0E21\u0E14\u0E41\u0E21\u0E15\u0E0A\u0E4C: \u0E08\u0E1A\u0E43\u0E19 ", state.matchRoundsRemaining, " \u0E15\u0E32") : /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.greenBtn), { marginTop: 10 }), onClick: startLastRounds }, '\u0E40\u0E25\u0E48\u0E19\u0E41\u0E1A\u0E1A "4 \u0E15\u0E32\u0E2A\u0E38\u0E14\u0E17\u0E49\u0E32\u0E22"')), state.mySeat === 0 ? /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.goldBtn), { marginTop: 10 }), onClick: startGame }, "\u0E40\u0E23\u0E34\u0E48\u0E21\u0E40\u0E01\u0E21") : /* @__PURE__ */ React.createElement("p", { style: { color: "#8a9a8e", textAlign: "center", marginTop: 14 } }, "\u0E23\u0E2D\u0E40\u0E08\u0E49\u0E32\u0E02\u0E2D\u0E07\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E34\u0E48\u0E21\u0E40\u0E01\u0E21..."), /* @__PURE__ */ React.createElement(ChatPanel, { chat, chatInput, setChatInput, sendChat, mySeat: state.mySeat }), /* @__PURE__ */ React.createElement("p", { style: { textAlign: "center", marginTop: 10 } }, /* @__PURE__ */ React.createElement("span", { onClick: leaveRoom, style: { color: "#5a7a9f", fontSize: 11, textDecoration: "underline", cursor: "pointer" } }, "\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E2B\u0E49\u0E2D\u0E07"))));
  }
  if (state.phase === "seatdraw" && state.seatDraw) {
    const sd = state.seatDraw;
    const step = Object.keys(sd.picks).length;
    return /* @__PURE__ */ React.createElement("div", { style: styles.bg }, /* @__PURE__ */ React.createElement("div", { style: styles.card }, /* @__PURE__ */ React.createElement("h2", { style: { color: "#d4af37", textAlign: "center", marginBottom: 4 } }, "\u{1F3B2} \u0E08\u0E31\u0E1A\u0E17\u0E35\u0E48\u0E19\u0E31\u0E48\u0E07\u0E43\u0E2B\u0E21\u0E48"), /* @__PURE__ */ React.createElement("p", { style: { color: "#8a9a8e", textAlign: "center", fontSize: 12, marginBottom: 16 } }, "\u0E43\u0E04\u0E23\u0E44\u0E14\u0E49\u0E44\u0E1E\u0E48\u0E43\u0E2B\u0E0D\u0E48\u0E2A\u0E38\u0E14\u0E44\u0E14\u0E49\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E17\u0E35\u0E48\u0E19\u0E31\u0E48\u0E07\u0E01\u0E48\u0E2D\u0E19"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center", gap: 8, marginBottom: 20 } }, sd.order.map((oldSeat) => /* @__PURE__ */ React.createElement("div", { key: oldSeat, style: { textAlign: "center" } }, /* @__PURE__ */ React.createElement(PlayingCard, { card: sd.cards[oldSeat] }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#8a9a8e", marginTop: 4, maxWidth: 60 } }, sd.playersAtDraw[oldSeat] || `\u0E1A\u0E2D\u0E17 ${oldSeat + 1}`), sd.picks[oldSeat] !== void 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#d4af37", fontWeight: 700 } }, "\u2192 \u0E17\u0E35\u0E48\u0E19\u0E31\u0E48\u0E07 ", sd.picks[oldSeat] + 1)))), /* @__PURE__ */ React.createElement("p", { style: { color: "#8a9a8e", textAlign: "center" } }, step >= 4 ? "\u0E08\u0E31\u0E14\u0E17\u0E35\u0E48\u0E19\u0E31\u0E48\u0E07\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E41\u0E25\u0E49\u0E27 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E08\u0E01\u0E44\u0E1E\u0E48..." : "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E08\u0E31\u0E14\u0E17\u0E35\u0E48\u0E19\u0E31\u0E48\u0E07...")));
  }
  const myHand = state.myHand || [];
  const isMyTurn = state.turn === state.mySeat && state.phase === "playing";
  const isLeadPlayer = state.mySeat === state.players.findIndex((p) => p !== null);
  const secsLeft = state.turnStartedAt ? Math.max(0, Math.ceil(state.turnSeconds - (Date.now() - state.turnStartedAt) / 1e3)) : null;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: styles.bg }, /* @__PURE__ */ React.createElement("div", { style: styles.wrap }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#d4af37", fontWeight: 700 } }, "\u0E2B\u0E49\u0E2D\u0E07 ", state.code, " \xB7 \u0E23\u0E2D\u0E1A\u0E17\u0E35\u0E48 ", state.round), state.matchRoundsRemaining !== null ? /* @__PURE__ */ React.createElement("span", { style: styles.matchBadgeActive }, "\u{1F3C1} \u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E2D\u0E35\u0E01 ", state.matchRoundsRemaining, " \u0E15\u0E32") : isLeadPlayer && /* @__PURE__ */ React.createElement("span", { onClick: startLastRounds, style: styles.matchBadge }, "\u{1F3C1} 4 \u0E15\u0E32\u0E2A\u0E38\u0E14\u0E17\u0E49\u0E32\u0E22")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { onClick: leaveRoom, style: { color: "#5a7a9f", fontSize: 10, textDecoration: "underline", cursor: "pointer" } }, "\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E2B\u0E49\u0E2D\u0E07")), /* @__PURE__ */ React.createElement(
    Table,
    {
      mySeat: state.mySeat,
      players: state.players,
      handCounts: state.handCounts,
      turn: state.turn,
      trickPile: state.trickPile,
      finished: state.finished,
      passedThisTrick: state.passedThisTrick,
      cumulative: state.cumulative,
      turnStartedAt: state.turnStartedAt,
      turnSeconds: state.turnSeconds
    }
  ), error && /* @__PURE__ */ React.createElement("div", { style: { color: "#e08a8a", fontSize: 12, textAlign: "center", marginBottom: 8 } }, error), state.phase === "playing" && /* @__PURE__ */ React.createElement(React.Fragment, null, isMyTurn && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", color: "#1a1a1a", background: "#d4af37", borderRadius: 6, padding: "6px 10px", fontWeight: 700, marginBottom: 8 } }, "\u0E15\u0E32\u0E04\u0E38\u0E13! ", secsLeft !== null && `\u23F1 ${secsLeft}s`), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: styles.statBox }, /* @__PURE__ */ React.createElement("span", { style: {
    display: "inline-block",
    width: 12,
    height: 12,
    borderRadius: "50%",
    flexShrink: 0,
    background: (state.passedThisTrick || []).includes(state.mySeat) ? "#6b6b6b" : SEAT_COLORS[state.mySeat],
    boxShadow: "0 0 6px rgba(255,255,255,.3)"
  } }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { color: "#f4e9d8", fontSize: 15, fontWeight: 800 } }, myHand.length === 1 ? /* @__PURE__ */ React.createElement("span", { style: { color: "#ff5252" } }, "BIG2! \u{1F525}") : `${myHand.length} \u0E43\u0E1A`), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#8a9a8e" } }, "\u0E44\u0E1E\u0E48\u0E43\u0E19\u0E21\u0E37\u0E2D\u0E04\u0E38\u0E13"))), /* @__PURE__ */ React.createElement("div", { style: styles.statBox }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, fontWeight: 900, color: state.cumulative[state.mySeat] >= 0 ? "#6fbf8a" : "#e08a8a" } }, state.cumulative[state.mySeat] >= 0 ? "+" : "", state.cumulative[state.mySeat]), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#8a9a8e" } }, "\u0E04\u0E30\u0E41\u0E19\u0E19\u0E2A\u0E30\u0E2A\u0E21"))), /* @__PURE__ */ React.createElement("div", { style: __spreadProps(__spreadValues({}, styles.statBox), { flex: "0 0 auto", cursor: "pointer", justifyContent: "center" }), onClick: () => setShowHistory(true) }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20 } }, "\u{1F4DC}"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#d4af37", fontWeight: 700 } }, "\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34")))), /* @__PURE__ */ React.createElement(Hand, { cards: myHand, selected, onToggle: toggleSelect }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.goldBtn), { flex: 1, opacity: isMyTurn && selected.length ? 1 : 0.5 }), disabled: !isMyTurn || selected.length === 0, onClick: () => playSelected() }, "\u0E25\u0E07\u0E44\u0E1E\u0E48 (", selected.length, ")"), /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.greenBtn), { flex: 1, opacity: isMyTurn ? 1 : 0.5 }), disabled: !isMyTurn, onClick: passTurn }, "\u0E1C\u0E48\u0E32\u0E19")), /* @__PURE__ */ React.createElement(ChatPanel, { chat, chatInput, setChatInput, sendChat, mySeat: state.mySeat })), state.phase === "finished" && /* @__PURE__ */ React.createElement("div", { style: styles.modalOverlay }, /* @__PURE__ */ React.createElement("div", { style: styles.modalCard }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40, textAlign: "center" } }, "\u{1F389}"), /* @__PURE__ */ React.createElement("div", { style: { color: "#d4af37", fontWeight: 700, fontSize: 16, textAlign: "center", marginTop: 4 } }, state.players[state.finished[0]] || `\u0E1A\u0E2D\u0E17 ${state.finished[0] + 1}`, " \u0E0A\u0E19\u0E30\u0E23\u0E2D\u0E1A\u0E17\u0E35\u0E48 ", state.round, "!"), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 16 } }, [state.mySeat, ...[0, 1, 2, 3].filter((s) => s !== state.mySeat)].map((s) => {
    const delta = state.payout ? state.payout.net[s] : 0;
    const hand = state.allHands ? state.allHands[s] : [];
    const pts = handPoints(hand);
    return /* @__PURE__ */ React.createElement("div", { key: s, style: { marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#f4e9d8", fontWeight: 600, marginBottom: 4, textAlign: "center" } }, s === state.mySeat ? "\u0E04\u0E38\u0E13" : state.players[s] || `\u0E1A\u0E2D\u0E17 ${s + 1}`, s === state.finished[0] ? " \u2014 \u0E0A\u0E19\u0E30 \u{1F3C6}" : ` \u2014 \u0E40\u0E2B\u0E25\u0E37\u0E2D ${pts} point`, " ", /* @__PURE__ */ React.createElement("span", { style: { color: delta >= 0 ? "#6fbf8a" : "#e08a8a", fontWeight: 700 } }, "(", delta >= 0 ? "+" : "", delta, ")")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center" } }, hand.length === 0 ? /* @__PURE__ */ React.createElement("span", { style: { color: "#6fbf8a", fontSize: 12 } }, "\u0E2B\u0E21\u0E14\u0E44\u0E1E\u0E48") : hand.map((c) => /* @__PURE__ */ React.createElement(PlayingCard, { key: cardKey(c), card: c, small: true }))));
  })), /* @__PURE__ */ React.createElement("p", { style: { color: "#8a9a8e", fontSize: 12, marginTop: 14, textAlign: "center" } }, state.matchRoundsRemaining !== null && state.matchRoundsRemaining <= 0 ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E38\u0E1B\u0E1C\u0E25\u0E41\u0E21\u0E15\u0E0A\u0E4C..." : "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E23\u0E34\u0E48\u0E21\u0E23\u0E2D\u0E1A\u0E15\u0E48\u0E2D\u0E44\u0E1B\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34..."))), state.phase === "gameover" && (() => {
    const finalScores = state.finalCumulative || [0, 0, 0, 0];
    return /* @__PURE__ */ React.createElement("div", { style: styles.modalOverlay }, /* @__PURE__ */ React.createElement("div", { style: styles.modalCard }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40, textAlign: "center" } }, "\u{1F3C1}"), /* @__PURE__ */ React.createElement("div", { style: { color: "#d4af37", fontWeight: 700, fontSize: 18, textAlign: "center", marginTop: 4, marginBottom: 16 } }, "\u0E08\u0E1A\u0E41\u0E21\u0E15\u0E0A\u0E4C!"), /* @__PURE__ */ React.createElement("div", null, [state.mySeat, ...[0, 1, 2, 3].filter((s) => s !== state.mySeat)].sort((a, b) => (finalScores[b] || 0) - (finalScores[a] || 0)).map((s, i) => {
      const score = finalScores[s] || 0;
      return /* @__PURE__ */ React.createElement("div", { key: s, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", marginBottom: 6, borderRadius: 10, background: i === 0 ? "rgba(212,175,55,.15)" : "rgba(255,255,255,.05)", border: i === 0 ? "1px solid #d4af37" : "1px solid transparent" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#f4e9d8", fontWeight: 600, fontSize: 14 } }, i === 0 && "\u{1F3C6} ", s === state.mySeat ? "\u0E04\u0E38\u0E13" : state.players[s] || `\u0E1A\u0E2D\u0E17 ${s + 1}`), /* @__PURE__ */ React.createElement("span", { style: { color: score >= 0 ? "#6fbf8a" : "#e08a8a", fontWeight: 900, fontSize: 16 } }, score >= 0 ? "+" : "", score));
    })), isLeadPlayer ? /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.goldBtn), { marginTop: 16 }), onClick: restartMatch }, "\u0E40\u0E25\u0E48\u0E19\u0E41\u0E21\u0E15\u0E0A\u0E4C\u0E43\u0E2B\u0E21\u0E48") : /* @__PURE__ */ React.createElement("p", { style: { color: "#8a9a8e", fontSize: 12, marginTop: 14, textAlign: "center" } }, "\u0E23\u0E2D\u0E40\u0E08\u0E49\u0E32\u0E02\u0E2D\u0E07\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E34\u0E48\u0E21\u0E41\u0E21\u0E15\u0E0A\u0E4C\u0E43\u0E2B\u0E21\u0E48...")));
  })())), showHistory && /* @__PURE__ */ React.createElement(HistoryModal, { roundHistory: state.roundHistory, players: state.players, mySeat: state.mySeat, cumulative: state.cumulative, onClose: () => setShowHistory(false) }));
}
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
