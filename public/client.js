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
  useEffect(() => {
    function measure() {
      if (ref.current) setW(ref.current.offsetWidth || 360);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const CARD_W = 68, gap = cards.length > 1 ? Math.min(CARD_W * 0.66, Math.max(14, (w - CARD_W) / (cards.length - 1))) : 0;
  const totalW = cards.length > 0 ? gap * (cards.length - 1) + CARD_W : CARD_W;
  return /* @__PURE__ */ React.createElement("div", { ref, style: { position: "relative", height: 118, width: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", height: 118, width: totalW, margin: "0 auto" } }, cards.map((c, i) => {
    const isSel = selected.some((s) => cardKey(s) === cardKey(c));
    return /* @__PURE__ */ React.createElement("div", { key: cardKey(c), onClick: () => onToggle(c), style: {
      position: "absolute",
      left: i * gap,
      top: isSel ? -14 : 0,
      transform: `rotate(${(i - (cards.length - 1) / 2) * (gap < 30 ? 1 : 1.4)}deg)`,
      transition: "left .18s, top .18s, transform .18s",
      zIndex: i
    } }, /* @__PURE__ */ React.createElement(PlayingCard, { card: c, large: true, selected: isSel }));
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
    const remainingFrac = Math.max(0, Math.min(1, 1 - elapsed / ((turnSeconds || 30) * 1e3)));
    const deg = remainingFrac * 360;
    return /* @__PURE__ */ React.createElement("div", { style: {
      padding: 3,
      borderRadius: 14,
      background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,.18) ${deg}deg)`,
      boxShadow: `0 0 12px ${color}99`
    } }, inner);
  }
  return /* @__PURE__ */ React.createElement("div", { style: { width: "100%", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center", marginBottom: 10 } }, /* @__PURE__ */ React.createElement(Seat, { seat: bySeat.top })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement(Seat, { seat: bySeat.left }), /* @__PURE__ */ React.createElement("div", { style: {
    position: "relative",
    flex: 1,
    minHeight: 170,
    borderRadius: "50%",
    background: "radial-gradient(ellipse at center, #1e5238 0%, #123526 70%, #0a2419 100%)",
    border: "9px solid #6b4226",
    boxShadow: "inset 0 0 0 5px #7a1f1f, inset 0 0 28px rgba(0,0,0,.5), 0 6px 16px rgba(0,0,0,.4)",
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
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1e3, padding: 16 },
  modalCard: { background: "#0f1f3a", border: "1px solid #2f5f8f", borderRadius: 16, padding: "22px 18px", width: "100%", maxWidth: 380, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,.5)" }
};
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
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("state", (s) => {
      setState(s);
      setScreen("room");
    });
    socket.on("actionError", (msg) => setError(msg));
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
      else setRoomCode(res.code);
    });
  }
  function joinRoom() {
    if (!name.trim() || !roomCode.trim()) {
      setError("\u0E43\u0E2A\u0E48\u0E0A\u0E37\u0E48\u0E2D\u0E41\u0E25\u0E30\u0E23\u0E2B\u0E31\u0E2A\u0E2B\u0E49\u0E2D\u0E07\u0E01\u0E48\u0E2D\u0E19\u0E04\u0E23\u0E31\u0E1A");
      return;
    }
    socketRef.current.emit("joinRoom", { name, code: roomCode.trim().toUpperCase() }, (res) => {
      if (!res.ok) setError(res.error || "\u0E40\u0E02\u0E49\u0E32\u0E2B\u0E49\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
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
  function nextRound() {
    socketRef.current.emit("nextRound", { code: state.code });
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
    return /* @__PURE__ */ React.createElement("div", { style: styles.bg }, /* @__PURE__ */ React.createElement("div", { style: styles.card }, /* @__PURE__ */ React.createElement("h2", { style: { color: "#f4e9d8", textAlign: "center" } }, "\u0E2B\u0E49\u0E2D\u0E07 ", state.code), /* @__PURE__ */ React.createElement("p", { style: { color: "#d4af37", fontSize: 13, textAlign: "center", marginBottom: 16 } }, '\u0E2A\u0E48\u0E07\u0E23\u0E2B\u0E31\u0E2A\u0E19\u0E35\u0E49\u0E43\u0E2B\u0E49\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E19 \u0E41\u0E25\u0E49\u0E27\u0E01\u0E14 "\u0E40\u0E02\u0E49\u0E32\u0E23\u0E48\u0E27\u0E21\u0E2B\u0E49\u0E2D\u0E07"'), [0, 1, 2, 3].map((i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,.05)", borderRadius: 6, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#f4e9d8" } }, "\u0E17\u0E35\u0E48\u0E19\u0E31\u0E48\u0E07 ", i + 1), /* @__PURE__ */ React.createElement("span", { style: { color: state.players[i] ? "#d4af37" : "#8a9a8e" } }, state.players[i] || (i === state.mySeat ? "\u0E04\u0E38\u0E13" : "\u0E27\u0E48\u0E32\u0E07 (\u0E1A\u0E2D\u0E17)")))), state.mySeat === 0 ? /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.goldBtn), { marginTop: 14 }), onClick: startGame }, "\u0E40\u0E23\u0E34\u0E48\u0E21\u0E40\u0E01\u0E21") : /* @__PURE__ */ React.createElement("p", { style: { color: "#8a9a8e", textAlign: "center", marginTop: 14 } }, "\u0E23\u0E2D\u0E40\u0E08\u0E49\u0E32\u0E02\u0E2D\u0E07\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E34\u0E48\u0E21\u0E40\u0E01\u0E21...")));
  }
  const myHand = state.myHand || [];
  const isMyTurn = state.turn === state.mySeat && state.phase === "playing";
  const secsLeft = state.turnStartedAt ? Math.max(0, Math.ceil(state.turnSeconds - (Date.now() - state.turnStartedAt) / 1e3)) : null;
  return /* @__PURE__ */ React.createElement("div", { style: styles.bg }, /* @__PURE__ */ React.createElement("div", { style: styles.wrap }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#d4af37", fontWeight: 700 } }, "\u0E2B\u0E49\u0E2D\u0E07 ", state.code, " \xB7 \u0E23\u0E2D\u0E1A\u0E17\u0E35\u0E48 ", state.round)), /* @__PURE__ */ React.createElement(
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
  } }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { color: "#f4e9d8", fontSize: 15, fontWeight: 800 } }, myHand.length === 1 ? /* @__PURE__ */ React.createElement("span", { style: { color: "#ff5252" } }, "BIG2! \u{1F525}") : `${myHand.length} \u0E43\u0E1A`), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#8a9a8e" } }, "\u0E44\u0E1E\u0E48\u0E43\u0E19\u0E21\u0E37\u0E2D\u0E04\u0E38\u0E13"))), /* @__PURE__ */ React.createElement("div", { style: styles.statBox }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, fontWeight: 900, color: state.cumulative[state.mySeat] >= 0 ? "#6fbf8a" : "#e08a8a" } }, state.cumulative[state.mySeat] >= 0 ? "+" : "", state.cumulative[state.mySeat]), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#8a9a8e" } }, "\u0E04\u0E30\u0E41\u0E19\u0E19\u0E2A\u0E30\u0E2A\u0E21")))), /* @__PURE__ */ React.createElement(Hand, { cards: myHand, selected, onToggle: toggleSelect }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.goldBtn), { flex: 1, opacity: isMyTurn && selected.length ? 1 : 0.5 }), disabled: !isMyTurn || selected.length === 0, onClick: () => playSelected() }, "\u0E25\u0E07\u0E44\u0E1E\u0E48 (", selected.length, ")"), /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.greenBtn), { flex: 1, opacity: isMyTurn ? 1 : 0.5 }), disabled: !isMyTurn, onClick: passTurn }, "\u0E1C\u0E48\u0E32\u0E19"))), state.phase === "finished" && /* @__PURE__ */ React.createElement("div", { style: styles.modalOverlay }, /* @__PURE__ */ React.createElement("div", { style: styles.modalCard }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40, textAlign: "center" } }, "\u{1F389}"), /* @__PURE__ */ React.createElement("div", { style: { color: "#d4af37", fontWeight: 700, fontSize: 16, textAlign: "center", marginTop: 4 } }, state.players[state.finished[0]] || `\u0E1A\u0E2D\u0E17 ${state.finished[0] + 1}`, " \u0E0A\u0E19\u0E30\u0E23\u0E2D\u0E1A\u0E17\u0E35\u0E48 ", state.round, "!"), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 16 } }, [state.mySeat, ...[0, 1, 2, 3].filter((s) => s !== state.mySeat)].map((s) => {
    const delta = state.payout ? state.payout.net[s] : 0;
    const hand = state.allHands ? state.allHands[s] : [];
    const pts = handPoints(hand);
    return /* @__PURE__ */ React.createElement("div", { key: s, style: { marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#f4e9d8", fontWeight: 600, marginBottom: 4, textAlign: "center" } }, s === state.mySeat ? "\u0E04\u0E38\u0E13" : state.players[s] || `\u0E1A\u0E2D\u0E17 ${s + 1}`, s === state.finished[0] ? " \u2014 \u0E0A\u0E19\u0E30 \u{1F3C6}" : ` \u2014 \u0E40\u0E2B\u0E25\u0E37\u0E2D ${pts} point`, " ", /* @__PURE__ */ React.createElement("span", { style: { color: delta >= 0 ? "#6fbf8a" : "#e08a8a", fontWeight: 700 } }, "(", delta >= 0 ? "+" : "", delta, ")")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center" } }, hand.length === 0 ? /* @__PURE__ */ React.createElement("span", { style: { color: "#6fbf8a", fontSize: 12 } }, "\u0E2B\u0E21\u0E14\u0E44\u0E1E\u0E48") : hand.map((c) => /* @__PURE__ */ React.createElement(PlayingCard, { key: cardKey(c), card: c, small: true }))));
  })), state.mySeat === state.finished[0] || state.players[state.finished[0]] === null && state.mySeat === 0 ? /* @__PURE__ */ React.createElement("button", { style: __spreadProps(__spreadValues({}, styles.goldBtn), { marginTop: 14 }), onClick: nextRound }, "\u0E40\u0E23\u0E34\u0E48\u0E21\u0E23\u0E2D\u0E1A\u0E15\u0E48\u0E2D\u0E44\u0E1B") : /* @__PURE__ */ React.createElement("p", { style: { color: "#8a9a8e", fontSize: 12, marginTop: 10, textAlign: "center" } }, "\u0E23\u0E2D\u0E1C\u0E39\u0E49\u0E0A\u0E19\u0E30\u0E01\u0E14\u0E40\u0E23\u0E34\u0E48\u0E21\u0E23\u0E2D\u0E1A\u0E15\u0E48\u0E2D\u0E44\u0E1B...")))));
}
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
