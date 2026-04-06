import { useState, useEffect, useRef } from "react";

// ─── Constants ───────────────────────────────────────────────
const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["3","4","5","6","7","8","9","10","J","Q","K","A","2"];
const VAL   = {"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,
               "J":11,"Q":12,"K":13,"A":14,"2":15,"小王":16,"大王":17};
// Counter-clockwise: you(0)→top(2)→left(1)→you(0)
const NEXT = [2, 0, 1];

// ─── Deck helpers ─────────────────────────────────────────────
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({s,r,id:`${s}${r}`});
  d.push({s:"J",r:"小王",id:"小王"});
  d.push({s:"J",r:"大王",id:"大王"});
  return d;
}
function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=0|Math.random()*(i+1);[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
const cv = c => VAL[c.r] || 0;
const isRed = c => c.s==="♥"||c.s==="♦"||c.r==="大王";
// Sort DESC (big first)
const sortD = arr => [...arr].sort((a,b)=> cv(b)-cv(a) || SUITS.indexOf(b.s)-SUITS.indexOf(a.s));

// ─── Hand Analysis ────────────────────────────────────────────
function analyze(cards) {
  if (!cards?.length) return null;
  const n = cards.length;
  const vs = cards.map(cv).sort((a,b)=>a-b);
  const cnt = {};
  for (const v of vs) cnt[v]=(cnt[v]||0)+1;
  const gs = Object.entries(cnt).map(([v,c])=>({v:+v,c})).sort((a,b)=>a.v-b.v);
  const mx = Math.max(...gs.map(g=>g.c));

  if (n===1) return {type:"single",val:vs[0]};
  if (n===2 && vs[0]===16 && vs[1]===17) return {type:"rocket",val:17};
  if (n===2 && mx===2) return {type:"pair",val:vs[0]};
  if (n===3 && mx===3) return {type:"triple",val:vs[0]};
  if (n===4 && mx===4) return {type:"bomb",val:vs[0]};
  if (n===4 && mx===3) { const t=gs.find(g=>g.c===3); return {type:"triple1",val:t.v}; }
  if (n===5 && gs.some(g=>g.c===3) && gs.some(g=>g.c===2)) {
    const t=gs.find(g=>g.c===3); return {type:"triple2",val:t.v};
  }
  if (n>=5 && gs.every(g=>g.c===1) && vs.every(v=>v<=14)) {
    if (vs.every((_,i)=>i===0||vs[i]-vs[i-1]===1))
      return {type:"seq",val:vs[n-1],len:n};
  }
  if (n>=6 && n%2===0 && gs.every(g=>g.c===2)) {
    const pv=gs.map(g=>g.v);
    if (pv.length>=3 && pv.every(v=>v<=14) && pv.every((_,i)=>i===0||pv[i]-pv[i-1]===1))
      return {type:"pairseq",val:pv[pv.length-1],len:pv.length};
  }
  const trips=gs.filter(g=>g.c>=3).map(g=>g.v).sort((a,b)=>a-b);
  if (trips.length>=2 && trips.every(v=>v<=14) && trips.every((_,i)=>i===0||trips[i]-trips[i-1]===1)) {
    const tc=trips.length*3, ex=n-tc;
    const top=trips[trips.length-1];
    if (ex===0)              return {type:"plane",val:top,len:trips.length};
    if (ex===trips.length)   return {type:"plane1",val:top,len:trips.length};
    if (ex===trips.length*2) return {type:"plane2",val:top,len:trips.length};
  }
  if (n===6 && mx===4) { const f=gs.find(g=>g.c===4); return {type:"four2",val:f.v}; }
  return null;
}

function beats(a, b) {
  if (!b) return !!a;
  if (!a) return false;
  if (a.type==="rocket") return true;
  if (b.type==="rocket") return false;
  if (a.type==="bomb" && b.type!=="bomb") return true;
  if (b.type==="bomb" && a.type!=="bomb") return false;
  if (a.type!==b.type) return false;
  if (a.len!==undefined && a.len!==b.len) return false;
  return a.val > b.val;
}

// ─── Smart AI ─────────────────────────────────────────────────
// Helpers
function getCounts(hand) {
  const cnt = {};
  for (const c of hand) { const v = cv(c); (cnt[v] = cnt[v] || []).push(c); }
  return cnt; // {value: [cards]}
}

// Score a hand's "strength" for free-play selection (lower = play first)
function handScore(cards) {
  const info = analyze(cards);
  if (!info) return 999;
  const baseVal = info.val;
  const penalty = {
    single: 0, pair: 1, triple: 3, triple1: 4, triple2: 5,
    seq: 6, pairseq: 7, plane: 8, plane1: 9, plane2: 10,
    four2: 12, four2pair: 13, bomb: 50, rocket: 100,
  };
  return (penalty[info.type] || 0) * 20 + baseVal;
}

// Decompose hand into best playable groups (greedy)
function decomposeHand(hand) {
  const cnt = getCounts(hand);
  const groups = [];
  const entries = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).sort((a,b)=>a.v-b.v);

  // Find sequences of triples (planes)
  const tripleVals = entries.filter(e=>e.cs.length>=3).map(e=>e.v);
  for (let len = Math.min(tripleVals.length, 4); len >= 2; len--) {
    for (let i = 0; i <= tripleVals.length - len; i++) {
      let consec = true;
      for (let j = 1; j < len; j++) if (tripleVals[i+j] - tripleVals[i+j-1] !== 1) { consec=false; break; }
      if (consec && tripleVals[i+len-1] <= 14) {
        const cards = tripleVals.slice(i, i+len).flatMap(v => cnt[v].slice(0,3));
        groups.push(cards);
      }
    }
  }
  // Single triples
  for (const {v, cs} of entries) if (cs.length >= 3 && v <= 14) groups.push(cs.slice(0,3));

  // Pair sequences (连对)
  const pairVals = entries.filter(e=>e.cs.length>=2&&e.v<=14).map(e=>e.v);
  for (let len = Math.min(pairVals.length, 6); len >= 3; len--) {
    for (let i = 0; i <= pairVals.length - len; i++) {
      let consec = true;
      for (let j = 1; j < len; j++) if (pairVals[i+j] - pairVals[i+j-1] !== 1) { consec=false; break; }
      if (consec) {
        const cards = pairVals.slice(i, i+len).flatMap(v => cnt[v].slice(0,2));
        groups.push(cards);
      }
    }
  }
  // Single pairs
  for (const {v, cs} of entries) if (cs.length >= 2 && v <= 14) groups.push(cs.slice(0,2));

  // Sequences (顺子) length 5+
  const singleVals = entries.filter(e=>e.v<=14).map(e=>e.v);
  for (let len = Math.min(singleVals.length, 12); len >= 5; len--) {
    for (let i = 0; i <= singleVals.length - len; i++) {
      let consec = true;
      for (let j = 1; j < len; j++) if (singleVals[i+j] - singleVals[i+j-1] !== 1) { consec=false; break; }
      if (consec) {
        const cards = singleVals.slice(i, i+len).map(v => cnt[v][0]);
        groups.push(cards);
      }
    }
  }

  // Singles
  for (const {v, cs} of entries) groups.push([cs[0]]);

  // Bombs
  for (const {v, cs} of entries) if (cs.length >= 4) groups.push(cs.slice(0,4));
  const jokers = hand.filter(c=>c.r==="小王"||c.r==="大王");
  if (jokers.length === 2) groups.push(jokers);

  return groups.filter(g => analyze(g) !== null);
}

// Find minimal beat for a given pattern
function findMinBeat(hand, lastInfo) {
  const cnt = getCounts(hand);
  const {type, val, len} = lastInfo;
  const candidates = [];

  if (type === "single") {
    for (const c of sortD(hand)) {
      if (cv(c) > val) { candidates.push([c]); break; } // just smallest winner
    }
  } else if (type === "pair") {
    const entries = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).sort((a,b)=>a.v-b.v);
    for (const {v, cs} of entries) {
      if (v > val && cs.length >= 2) { candidates.push(cs.slice(0,2)); break; }
    }
  } else if (type === "triple") {
    const entries = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).sort((a,b)=>a.v-b.v);
    for (const {v, cs} of entries) {
      if (v > val && cs.length >= 3) { candidates.push(cs.slice(0,3)); break; }
    }
  } else if (type === "triple1") {
    const entries = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).sort((a,b)=>a.v-b.v);
    for (const {v, cs} of entries) {
      if (v > val && cs.length >= 3) {
        const kickers = hand.filter(c=>cv(c)!==v);
        if (kickers.length >= 1) { candidates.push([...cs.slice(0,3), kickers[kickers.length-1]]); break; }
      }
    }
  } else if (type === "triple2") {
    const entries = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).sort((a,b)=>a.v-b.v);
    for (const {v, cs} of entries) {
      if (v > val && cs.length >= 3) {
        const pairEntries = Object.entries(cnt).filter(([pv,pcs])=>+pv!==v&&pcs.length>=2);
        if (pairEntries.length >= 1) {
          const [pv, pcs] = pairEntries[0];
          candidates.push([...cs.slice(0,3), ...pcs.slice(0,2)]); break;
        }
      }
    }
  } else if (type === "seq") {
    // Find smallest sequence of same length that beats val
    const singleVals = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).filter(e=>e.v<=14).sort((a,b)=>a.v-b.v);
    for (let i = 0; i <= singleVals.length - len; i++) {
      if (singleVals[i+len-1].v <= val) continue;
      let consec = true;
      for (let j = 1; j < len; j++) if (singleVals[i+j].v - singleVals[i+j-1].v !== 1) { consec=false; break; }
      if (consec && singleVals[i+len-1].v > val) {
        candidates.push(singleVals.slice(i, i+len).map(e=>e.cs[0])); break;
      }
    }
  } else if (type === "pairseq") {
    const pairEntries = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).filter(e=>e.cs.length>=2&&e.v<=14).sort((a,b)=>a.v-b.v);
    for (let i = 0; i <= pairEntries.length - len; i++) {
      if (pairEntries[i+len-1].v <= val) continue;
      let consec = true;
      for (let j = 1; j < len; j++) if (pairEntries[i+j].v - pairEntries[i+j-1].v !== 1) { consec=false; break; }
      if (consec && pairEntries[i+len-1].v > val) {
        candidates.push(pairEntries.slice(i, i+len).flatMap(e=>e.cs.slice(0,2))); break;
      }
    }
  } else if (type === "plane" || type === "plane1" || type === "plane2") {
    const tripleEntries = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).filter(e=>e.cs.length>=3&&e.v<=14).sort((a,b)=>a.v-b.v);
    for (let i = 0; i <= tripleEntries.length - len; i++) {
      if (tripleEntries[i+len-1].v <= val) continue;
      let consec = true;
      for (let j = 1; j < len; j++) if (tripleEntries[i+j].v - tripleEntries[i+j-1].v !== 1) { consec=false; break; }
      if (consec && tripleEntries[i+len-1].v > val) {
        const tripleCards = tripleEntries.slice(i, i+len).flatMap(e=>e.cs.slice(0,3));
        if (type === "plane") { candidates.push(tripleCards); break; }
        // plane1: need len kickers
        const usedVals = new Set(tripleEntries.slice(i,i+len).map(e=>e.v));
        const kickers = hand.filter(c=>!usedVals.has(cv(c)));
        if (type === "plane1" && kickers.length >= len) {
          candidates.push([...tripleCards, ...sortD(kickers).slice(-len)]); break;
        }
        if (type === "plane2" && kickers.length >= len*2) {
          candidates.push([...tripleCards, ...sortD(kickers).slice(-len*2)]); break;
        }
      }
    }
  } else if (type === "bomb") {
    const entries = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).sort((a,b)=>a.v-b.v);
    for (const {v, cs} of entries) {
      if (v > val && cs.length >= 4) { candidates.push(cs.slice(0,4)); break; }
    }
  }

  // Bombs can always beat non-bomb/rocket
  if (!["bomb","rocket"].includes(type)) {
    const entries = Object.entries(cnt).map(([v,cs])=>({v:+v,cs})).sort((a,b)=>a.v-b.v);
    for (const {v, cs} of entries) {
      if (cs.length >= 4) { candidates.push(cs.slice(0,4)); break; }
    }
    const jokers = hand.filter(c=>c.r==="小王"||c.r==="大王");
    if (jokers.length === 2) candidates.push(jokers);
  }

  return candidates;
}

// Estimate how many "moves" needed to empty a hand (fewer = stronger hand)
function movesToFinish(hand) {
  const cnt = getCounts(hand);
  const vals = Object.entries(cnt).map(([v,cs])=>({v:+v,n:cs.length})).sort((a,b)=>a.v-b.v);
  let moves = 0;
  const used = new Set();

  // Count quads as bombs
  for (const {v,n} of vals) if (n>=4) { moves++; used.add(v); }
  // Count triples
  for (const {v,n} of vals) if (!used.has(v) && n>=3) { moves++; used.add(v); }
  // Count pairs
  for (const {v,n} of vals) if (!used.has(v) && n>=2) { moves++; used.add(v); }
  // Count singles
  for (const {v,n} of vals) if (!used.has(v)) { moves++; used.add(v); }
  return moves;
}

// Main AI decision function
// pos: who is this AI (0,1,2)
// landlord: who is landlord
// hand: this AI's hand
// lastInfo: last played hand info
// lastBy: who played last
// otherHandSize: {1: n, 2: n} — approximate size of others' hands
function aiChoose(pos, landlord, hand, lastInfo, lastBy, handSizes) {
  const isLandlord = pos === landlord;
  const ally = isLandlord ? null : [0,1,2].find(i=>i!==pos&&i!==landlord);
  const enemy = isLandlord ? [0,1,2].filter(i=>i!==pos) : [landlord];

  // ── FREE PLAY (no last card to beat) ──
  if (!lastInfo) {
    const groups = decomposeHand(hand);
    // Pick the weakest valid group (lowest score) to play first
    // But if we're close to winning (<=2 moves), play strongest
    const moves = movesToFinish(hand);

    if (isLandlord) {
      // Landlord: aggressive — try to control the round
      // If <=3 cards left, just play them
      if (hand.length <= 3) {
        const info = analyze(hand);
        if (info) return hand;
      }
      // Prefer to play singles/pairs of small cards to reduce hand
      const singles = groups.filter(g=>g.length===1&&analyze(g)?.type==="single").sort((a,b)=>cv(a[0])-cv(b[0]));
      const pairs   = groups.filter(g=>analyze(g)?.type==="pair").sort((a,b)=>cv(a[0])-cv(b[0]));
      const seqs    = groups.filter(g=>["seq","pairseq","plane","plane1","plane2"].includes(analyze(g)?.type));
      // Play sequences/planes first to shed cards efficiently
      if (seqs.length > 0) return seqs.sort((a,b)=>handScore(a)-handScore(b))[0];
      if (singles.length > 0) return singles[0];
      if (pairs.length > 0) return pairs[0];
      return sortD(hand).slice(-1); // fallback: single smallest
    } else {
      // Peasant: cooperative — don't waste bombs unless necessary
      // If ally is very close to winning, just pass (but free play means we must play)
      const allySizes = [0,1,2].filter(i=>i!==pos).map(i=>handSizes[i]||17);
      const allyClose = ally !== null && (handSizes[ally]||17) <= 3;
      const enemyClose = enemy.some(e=>(handSizes[e]||17)<=3);

      if (hand.length <= 2) {
        const info = analyze(hand);
        if (info) return hand;
      }

      // Play weakest cards to let ally take control if ally is strong
      const seqs = groups.filter(g=>["seq","pairseq","plane","plane1","plane2"].includes(analyze(g)?.type));
      if (seqs.length > 0) return seqs.sort((a,b)=>handScore(a)-handScore(b))[0];

      // Play smallest single first
      const singles = groups.filter(g=>g.length===1&&analyze(g)?.type==="single").sort((a,b)=>cv(a[0])-cv(b[0]));
      if (singles.length > 0) return singles[0];
      const pairs = groups.filter(g=>analyze(g)?.type==="pair").sort((a,b)=>cv(a[0])-cv(b[0]));
      if (pairs.length > 0) return pairs[0];
      return sortD(hand).slice(-1);
    }
  }

  // ── MUST BEAT or PASS ──
  const allyPlayed = ally !== null && lastBy === ally;
  const enemyPlayed = enemy.includes(lastBy);

  // Peasant: if ally just played and is winning, PASS (let ally win)
  if (!isLandlord && allyPlayed) {
    // Check if ally is close to running out
    const allyCards = handSizes[ally] || 17;
    if (allyCards <= 4) return null; // let ally win, don't interfere
    // Also pass if ally played a powerful card (high value single/pair/bomb)
    if (lastInfo.val >= 14) return null; // A or above — let it ride
    if (lastInfo.type === "bomb" || lastInfo.type === "rocket") return null;
    // For lower cards, still try to pass to save cards
    if (allyCards <= 8 && lastInfo.val >= 10) return null;
  }

  // Find minimum beat
  const candidates = findMinBeat(hand, lastInfo);
  if (!candidates.length) return null; // can't beat, pass

  // Landlord: always try to beat if we have a way
  if (isLandlord) {
    // Only use bombs if necessary or close to winning
    const normalCands = candidates.filter(c=>{const i=analyze(c);return i&&i.type!=="bomb"&&i.type!=="rocket";});
    const bombCands   = candidates.filter(c=>{const i=analyze(c);return i&&(i.type==="bomb"||i.type==="rocket");});

    // If landlord is close to winning, use anything
    if (hand.length <= 4) return candidates[0];
    // Use normal beat if available
    if (normalCands.length) return normalCands[0];
    // Use bomb only if enemy (peasant) is dangerously close to winning
    const peasantClose = enemy.some(e=>(handSizes[e]||17)<=3);
    if (bombCands.length && peasantClose) return bombCands[0];
    return null; // save bomb for later
  }

  // Peasant beating the landlord
  if (!isLandlord && enemyPlayed) {
    const llCards = handSizes[landlord] || 17;
    const normalCands = candidates.filter(c=>{const i=analyze(c);return i&&i.type!=="bomb"&&i.type!=="rocket";});
    const bombCands   = candidates.filter(c=>{const i=analyze(c);return i&&(i.type==="bomb"||i.type==="rocket");});

    // If landlord very close to winning, must use bomb
    if (llCards <= 2 && bombCands.length) return bombCands[0];
    // Use normal beat if available
    if (normalCands.length) return normalCands[0];
    // Use bomb only if landlord very close
    if (bombCands.length && llCards <= 4) return bombCands[0];
    return null; // pass, save resources
  }

  return null; // default pass
}

// ─── SVG Avatars ──────────────────────────────────────────────
function AvatarSVG({idx, isLL}) {
  if (idx===0) return isLL ? (
    // You: landlord (young man with crown)
    <g>
      <circle cx="24" cy="20" r="11" fill="#FDBCB4"/>
      <ellipse cx="24" cy="11" rx="11" ry="7" fill="#3d2000"/>
      <rect x="13" y="30" width="22" height="13" rx="5" fill="#8b0000"/>
      <circle cx="19" cy="19" r="2" fill="#2c1810"/>
      <circle cx="29" cy="19" r="2" fill="#2c1810"/>
      <path d="M18 25 Q24 30 30 25" stroke="#c47a5a" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <path d="M19 28 Q24 33 29 28" stroke="#5c3317" strokeWidth="1.8" fill="none"/>
      <line x1="22" y1="29" x2="21" y2="34" stroke="#5c3317" strokeWidth="1.5"/>
      <line x1="24" y1="30" x2="24" y2="35" stroke="#5c3317" strokeWidth="1.5"/>
      <line x1="26" y1="29" x2="27" y2="34" stroke="#5c3317" strokeWidth="1.5"/>
      <polygon points="11,12 16,3 24,10 32,3 37,12" fill="#ffd700" stroke="#ffa500" strokeWidth="1"/>
      <circle cx="16" cy="4" r="2.2" fill="#ff4500"/>
      <circle cx="24" cy="11" r="2.2" fill="#ff4500"/>
      <circle cx="32" cy="4" r="2.2" fill="#ff4500"/>
    </g>
  ) : (
    // You: peasant (young man with straw hat)
    <g>
      <circle cx="24" cy="20" r="11" fill="#FDBCB4"/>
      <ellipse cx="24" cy="11" rx="11" ry="7" fill="#3d2000"/>
      <rect x="14" y="30" width="20" height="13" rx="5" fill="#4a90d9"/>
      <circle cx="19" cy="19" r="2" fill="#2c1810"/>
      <circle cx="29" cy="19" r="2" fill="#2c1810"/>
      <path d="M19 24 Q24 28 29 24" stroke="#c47a5a" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <ellipse cx="24" cy="10" rx="14" ry="4.5" fill="#d4a017"/>
      <rect x="18" y="4" width="12" height="8" rx="4" fill="#b8860b"/>
    </g>
  );

  if (idx===1) return isLL ? (
    // Old man landlord (fat, crown, money)
    <g>
      <ellipse cx="24" cy="21" rx="12" ry="11" fill="#e8c49a"/>
      <rect x="12" y="31" width="24" height="13" rx="5" fill="#7a2010"/>
      <ellipse cx="13" cy="24" rx="5" ry="4" fill="#ffb090" opacity="0.4"/>
      <ellipse cx="35" cy="24" rx="5" ry="4" fill="#ffb090" opacity="0.4"/>
      <path d="M19 18 Q21 16 23 18" stroke="#2c1810" strokeWidth="1.8" fill="none"/>
      <path d="M25 18 Q27 16 29 18" stroke="#2c1810" strokeWidth="1.8" fill="none"/>
      <path d="M18 26 Q24 32 30 26" stroke="#c47a5a" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <ellipse cx="32" cy="36" rx="5" ry="4" fill="#ffd700"/>
      <text x="29" y="39" fontSize="6" fill="#8b6914" fontWeight="bold">¥¥</text>
      <polygon points="11,11 16,2 24,9 32,2 37,11" fill="#ffd700" stroke="#ffa500" strokeWidth="1"/>
      <circle cx="16" cy="3" r="2.2" fill="#ff4500"/>
      <circle cx="24" cy="10" r="2.2" fill="#ff4500"/>
      <circle cx="32" cy="3" r="2.2" fill="#ff4500"/>
    </g>
  ) : (
    // Old man peasant (pipe, headband)
    <g>
      <circle cx="24" cy="20" r="10" fill="#e8c49a"/>
      <ellipse cx="24" cy="12" rx="9" ry="6" fill="#5c4030"/>
      <rect x="14" y="30" width="20" height="13" rx="5" fill="#5a7a5a"/>
      <path d="M17 18 Q20 16 23 18" stroke="#c8a882" strokeWidth="1.2" fill="none"/>
      <path d="M25 18 Q28 16 31 18" stroke="#c8a882" strokeWidth="1.2" fill="none"/>
      <path d="M19 18 Q21 16 23 18" stroke="#2c1810" strokeWidth="1.8" fill="none"/>
      <path d="M25 18 Q27 16 29 18" stroke="#2c1810" strokeWidth="1.8" fill="none"/>
      <path d="M20 24 Q24 22 28 24" stroke="#5c3317" strokeWidth="2.2" fill="none"/>
      <rect x="28" y="24" width="9" height="2.5" rx="1.2" fill="#8b5e3c"/>
      <ellipse cx="37.5" cy="23" rx="3" ry="3.5" fill="#7a4e2d" opacity="0.85"/>
      <rect x="15" y="15" width="18" height="3" rx="1.5" fill="#cc3333"/>
    </g>
  );

  // idx===2
  return isLL ? (
    // Woman landlord (tiara, pearl necklace)
    <g>
      <circle cx="24" cy="20" r="10" fill="#FDBCB4"/>
      <ellipse cx="24" cy="11" rx="11" ry="7" fill="#1c1008"/>
      <rect x="13" y="11" width="4" height="16" rx="2" fill="#1c1008"/>
      <rect x="31" y="11" width="4" height="16" rx="2" fill="#1c1008"/>
      <rect x="13" y="30" width="22" height="13" rx="5" fill="#c0392b"/>
      <ellipse cx="19" cy="19" rx="2.5" ry="2" fill="#fff"/>
      <circle cx="19" cy="19" r="1.5" fill="#2c1810"/>
      <ellipse cx="29" cy="19" rx="2.5" ry="2" fill="#fff"/>
      <circle cx="29" cy="19" r="1.5" fill="#2c1810"/>
      <circle cx="16" cy="23" r="3.5" fill="#ffb0a0" opacity="0.55"/>
      <circle cx="32" cy="23" r="3.5" fill="#ffb0a0" opacity="0.55"/>
      <path d="M18 25 Q24 30 30 25" stroke="#e07090" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <path d="M16 30 Q24 34 32 30" stroke="white" strokeWidth="2" fill="none" strokeDasharray="2.5,2"/>
      <path d="M14 12 L17 5 L20 10 L24 3 L28 10 L31 5 L34 12" stroke="#ffd700" strokeWidth="2.5" fill="none" strokeLinejoin="round"/>
      <circle cx="24" cy="4" r="2.5" fill="#ff69b4"/>
      <circle cx="17" cy="6" r="1.8" fill="#ffd700"/>
      <circle cx="31" cy="6" r="1.8" fill="#ffd700"/>
    </g>
  ) : (
    // Woman peasant (headscarf)
    <g>
      <circle cx="24" cy="20" r="10" fill="#FDBCB4"/>
      <ellipse cx="24" cy="11" rx="11" ry="7" fill="#1c1008"/>
      <rect x="13" y="11" width="4" height="14" rx="2" fill="#1c1008"/>
      <rect x="31" y="11" width="4" height="14" rx="2" fill="#1c1008"/>
      <rect x="14" y="30" width="20" height="13" rx="5" fill="#e8a0c8"/>
      <ellipse cx="19" cy="19" rx="2.5" ry="2" fill="#fff"/>
      <circle cx="19" cy="19" r="1.5" fill="#2c1810"/>
      <ellipse cx="29" cy="19" rx="2.5" ry="2" fill="#fff"/>
      <circle cx="29" cy="19" r="1.5" fill="#2c1810"/>
      <circle cx="16" cy="23" r="3.5" fill="#ffb0a0" opacity="0.55"/>
      <circle cx="32" cy="23" r="3.5" fill="#ffb0a0" opacity="0.55"/>
      <path d="M19 24 Q24 28 29 24" stroke="#e07090" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M13 14 Q24 5 35 14 Q32 8 24 6 Q16 8 13 14Z" fill="#e83040" opacity="0.85"/>
    </g>
  );
}

function Avatar({idx, isLL, size=46, active}) {
  return (
    <div style={{
      width:size, height:size, borderRadius:"50%", overflow:"hidden", flexShrink:0,
      background:"radial-gradient(circle,#fff8e1,#ffe082)",
      border: isLL ? "3px solid #f39c12" : active ? "3px solid #27ae60" : "2px solid rgba(0,0,0,0.12)",
      boxShadow: isLL ? "0 0 14px rgba(243,156,18,0.65)" : active ? "0 0 10px rgba(39,174,96,0.55)" : "0 2px 5px rgba(0,0,0,0.12)",
      transition:"border 0.4s, box-shadow 0.4s",
    }}>
      <svg width={size} height={size} viewBox="0 0 48 48">
        <AvatarSVG idx={idx} isLL={isLL}/>
      </svg>
    </div>
  );
}

// ─── Card Component ───────────────────────────────────────────
// sm=true: table/played cards (medium), sm=false: player hand (large)
function Card({card, sel, onTap, faceDown, sm}) {
  const w = sm ? 44 : 64, h = sm ? 64 : 92;
  if (faceDown) return (
    <div style={{
      width:w, height:h, borderRadius:8, flexShrink:0,
      background:"linear-gradient(135deg,#c0392b,#7b241c)",
      border:"2px solid #e74c3c",
      boxShadow:"0 2px 6px rgba(0,0,0,0.28)",
      display:"flex",alignItems:"center",justifyContent:"center",
    }}>
      <div style={{width:"70%",height:"70%",border:"1.5px solid rgba(255,255,255,0.25)",borderRadius:5,
        background:"repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,0.07) 3px,rgba(255,255,255,0.07) 6px)"}}/>
    </div>
  );
  const red = isRed(card);
  const joker = card.r==="小王"||card.r==="大王";
  return (
    <div onClick={onTap} style={{
      width:w, height:h, borderRadius:8, flexShrink:0, position:"relative",
      background: sel ? "linear-gradient(135deg,#fffbe6,#fff3b0)" : "#fff",
      border: sel ? "2.5px solid #f59e0b" : "2px solid #ddd",
      boxShadow: sel ? "0 0 16px rgba(245,158,11,0.6),0 4px 10px rgba(0,0,0,0.14)" : "0 2px 6px rgba(0,0,0,0.18)",
      transform: sel ? "translateY(-22px)" : "translateY(0)",
      transition:"transform 0.13s,box-shadow 0.13s,border 0.13s",
      cursor: onTap ? "pointer" : "default",
      userSelect:"none", display:"flex",alignItems:"center",justifyContent:"center",
    }}>
      {joker ? (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
          <div style={{fontSize:sm?22:30}}>{card.r==="大王"?"🔥":"⚡"}</div>
          <div style={{fontSize:sm?9:12,fontWeight:"bold",color:card.r==="大王"?"#c0392b":"#2c3e50"}}>{card.r}</div>
        </div>
      ) : (
        <>
          <div style={{position:"absolute",top:3,left:4,lineHeight:1.15,fontFamily:"Georgia,serif",
            fontSize:sm?11:15,fontWeight:"900",color:red?"#c0392b":"#1a1a2e"}}>
            <div>{card.r}</div><div style={{fontSize:sm?10:14}}>{card.s}</div>
          </div>
          <div style={{fontSize:sm?22:34,color:red?"#c0392b":"#1a1a2e"}}>{card.s}</div>
          <div style={{position:"absolute",bottom:3,right:4,lineHeight:1.15,fontFamily:"Georgia,serif",
            transform:"rotate(180deg)",fontSize:sm?11:15,fontWeight:"900",color:red?"#c0392b":"#1a1a2e"}}>
            <div>{card.r}</div><div style={{fontSize:sm?10:14}}>{card.s}</div>
          </div>
        </>
      )}
    </div>
  );
}

// Fan of face-down cards
function FaceDownFan({count, vertical}) {
  if (count===0) return null;
  const overlap = vertical ? -36 : -28;
  return (
    <div style={{
      display:"flex",
      flexDirection: vertical ? "column" : "row",
      alignItems:"center",
    }}>
      {Array.from({length:count}).map((_,i)=>(
        <div key={i} style={vertical ? {marginTop:i===0?0:overlap} : {marginLeft:i===0?0:overlap}}>
          <Card card={{s:"?",r:"?",id:`fd${i}`}} faceDown sm/>
        </div>
      ))}
    </div>
  );
}

// Table played cards or "pass"
function Played({cards, passed, who, label}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,minHeight:40}}>
      {label && (
        <div style={{fontSize:11,color:"#888",fontWeight:"bold",letterSpacing:1}}>{label}</div>
      )}
      {passed ? (
        <div style={{padding:"6px 18px",background:"rgba(192,57,43,0.1)",borderRadius:20,
          color:"#c0392b",fontSize:14,fontWeight:"bold",border:"1px solid rgba(192,57,43,0.22)"}}>
          不出
        </div>
      ) : cards?.length ? (
        <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"center"}}>
          {cards.map(c=><Card key={c.id} card={c} sm/>)}
        </div>
      ) : null}
    </div>
  );
}

// ─── Main Game Component ──────────────────────────────────────
export default function App() {
  // "menu" | "bidding" | "playing" | "gameover"
  const [screen, setScreen] = useState("menu");

  // Game state — all in one object to avoid stale closure bugs
  const [G, setG] = useState(null);

  // Selection for player
  const [sel, setSel] = useState(new Set());
  const [err, setErr] = useState("");
  const [scores, setScores] = useState([0,0,0]);

  const aiTimer = useRef(null);
  const stopAI = () => { if(aiTimer.current) clearTimeout(aiTimer.current); };

  // ── Start new game ──
  function startGame() {
    stopAI();
    const deck = shuffle(makeDeck());
    const h = [sortD(deck.slice(0,17)), sortD(deck.slice(17,34)), sortD(deck.slice(34,51))];
    const kitty = deck.slice(51);
    setG({
      hands: h,
      kitty,
      landlord: null,
      // bidding: bidIdx cycles 0→2→1
      bidStep: 0,    // 0,1,2 = which step in BID_ORDER
      bids: [null,null,null],
      turn: 0,
      lastCards: null,   // array of cards last played
      lastInfo: null,    // analyzed hand
      lastBy: null,
      table: [null,null,null],  // what each player has on table ("pass" or card array)
      passed: [false,false,false],
      showKitty: false,
      phase: "bidding",
    });
    setSel(new Set());
    setErr("");
    setScreen("bidding");
  }

  // Bid order: step0=player0, step1=player2, step2=player1
  const BID_ORDER = [0, 2, 1];

  // ── Player bids ──
  function playerBid(val) {
    if (!G || G.phase!=="bidding" || G.bidStep!==0) return;
    const newBids = [...G.bids];
    newBids[0] = val;
    if (val===1) {
      // Player calls landlord — resolve immediately
      finalizeLandlord(newBids, G.hands, G.kitty);
    } else {
      // Move to step 1 (player 2)
      setG(g=>({...g, bids:newBids, bidStep:1}));
    }
  }

  // ── AI bids via effect ──
  useEffect(()=>{
    if (!G || G.phase!=="bidding") return;
    const step = G.bidStep;
    const who = BID_ORDER[step];
    if (who===0) return; // player's turn, wait
    stopAI();
    aiTimer.current = setTimeout(()=>{
      const hand = G.hands[who];
      const vc={};
      for(const c of hand) vc[cv(c)]=(vc[cv(c)]||0)+1;
      const hasBomb = Object.values(vc).some(n=>n>=4);
      const bigCards = hand.filter(c=>c.r==="A"||c.r==="2").length;
      const callLL = hasBomb || bigCards>=2 || Math.random()>0.5;
      const newBids=[...G.bids]; newBids[who]=callLL?1:0;
      if (step===2) {
        // all bid
        finalizeLandlord(newBids, G.hands, G.kitty);
      } else {
        setG(g=>({...g, bids:newBids, bidStep:step+1}));
      }
    }, 900);
    return stopAI;
  }, [G?.bidStep, G?.phase]);

  function finalizeLandlord(bids, hands, kitty) {
    const mx = Math.max(...bids.map(b=>b||0));
    const ll = mx===0 ? 0 : bids.indexOf(mx);
    const newHands = hands.map((h,i)=> i===ll ? sortD([...h,...kitty]) : [...h]);
    setG(g=>({
      ...g,
      bids,
      landlord: ll,
      hands: newHands,
      showKitty: true,
      phase: "showkitty",
    }));
    setTimeout(()=>{
      setG(g=>({...g, showKitty:false, phase:"playing", turn:ll}));
      setScreen("playing");
    }, 2200);
  }

  // ── AI plays via effect ──
  useEffect(()=>{
    if (!G || G.phase!=="playing") return;
    if (G.turn===0) return; // human's turn
    stopAI();
    aiTimer.current = setTimeout(()=>{
      setG(g=>{
        if (!g || g.phase!=="playing" || g.turn===0) return g;
        const pos = g.turn;
        const hand = g.hands[pos];
        const canPassNow = g.lastInfo && g.lastBy !== pos;
        const handSizes = {0: g.hands[0].length, 1: g.hands[1].length, 2: g.hands[2].length};
        const chosen = aiChoose(pos, g.landlord, hand, canPassNow ? g.lastInfo : null, g.lastBy, handSizes);
        if (!chosen) {
          const newPassed=[...g.passed]; newPassed[pos]=true;
          const newTable=[...g.table]; newTable[pos]="pass";
          return advanceG({...g, passed:newPassed, table:newTable}, pos, null, null);
        } else {
          return playCards(g, pos, chosen);
        }
      });
    }, 950);
    return stopAI;
  }, [G?.turn, G?.phase]);

  function playCards(g, pos, cards) {
    const newHands=[...g.hands];
    newHands[pos] = sortD(g.hands[pos].filter(c=>!cards.find(p=>p.id===c.id)));
    const info = analyze(cards);
    const newTable=[null,null,null]; newTable[pos]=cards;
    const newPassed=[false,false,false];
    if (newHands[pos].length===0) {
      // Win!
      return {...g, hands:newHands, table:newTable, passed:newPassed, phase:"gameover", winner:pos};
    }
    return advanceG({...g, hands:newHands, table:newTable, passed:newPassed, lastCards:cards, lastInfo:info, lastBy:pos}, pos, info, pos);
  }

  // Compute next turn after pos acted
  function advanceG(g, pos, info, lastBy) {
    const next = NEXT[pos];
    // Check if other two both passed
    const others = [0,1,2].filter(i=>i!==lastBy);
    if (lastBy!==null && others.every(i=>g.passed[i])) {
      // reset, free play for lastBy
      return {...g, lastCards:null, lastInfo:null, lastBy:null, table:[null,null,null], passed:[false,false,false], turn:lastBy};
    }
    return {...g, turn:next};
  }

  // ── gameover effect ──
  useEffect(()=>{
    if (!G || G.phase!=="gameover") return;
    const w = G.winner;
    const ll = G.landlord;
    setScores(prev=>{
      const s=[...prev];
      if (w===ll) { s[ll]+=3; [0,1,2].filter(i=>i!==ll).forEach(i=>s[i]-=1); }
      else { [0,1,2].filter(i=>i!==ll).forEach(i=>s[i]+=1); s[ll]-=2; }
      return s;
    });
    setScreen("gameover");
  }, [G?.phase]);

  // ── Player actions ──
  function playerPlay() {
    if (!G || G.turn!==0 || G.phase!=="playing") return;
    const cards = G.hands[0].filter(c=>sel.has(c.id));
    if (!cards.length) return;
    const info = analyze(cards);
    if (!info) { setErr("❌ 无效牌型"); return; }
    if (G.lastInfo && G.lastBy!==0 && !beats(info,G.lastInfo)) { setErr("❌ 牌不够大"); return; }
    setErr(""); setSel(new Set());
    setG(g=> playCards(g, 0, cards));
  }

  function playerPass() {
    if (!G || G.turn!==0 || !G.lastInfo || G.lastBy===0) return;
    setErr(""); setSel(new Set());
    setG(g=>{
      const newPassed=[...g.passed]; newPassed[0]=true;
      const newTable=[...g.table]; newTable[0]="pass";
      return advanceG({...g, passed:newPassed, table:newTable}, 0, g.lastInfo, g.lastBy);
    });
  }

  function toggleCard(card) {
    if (!G || G.turn!==0 || G.phase!=="playing") return;
    setErr("");
    setSel(prev=>{ const n=new Set(prev); n.has(card.id)?n.delete(card.id):n.add(card.id); return n; });
  }

  const canPass = G?.phase==="playing" && G?.turn===0 && G?.lastInfo && G?.lastBy!==0;
  const ll = G?.landlord;

  // ═══════════════════════════
  //  MENU SCREEN
  // ═══════════════════════════
  if (screen==="menu") return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(135deg,#ff6b35 0%,#f7931e 30%,#ffcd3c 65%,#ff8c42 100%)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      fontFamily:"'Noto Serif SC','Georgia',serif", padding:24, position:"relative", overflow:"hidden",
    }}>
      {[150,90,55,120,70,40].map((sz,i)=>(
        <div key={i} style={{position:"absolute",width:sz,height:sz,borderRadius:"50%",
          background:"rgba(255,255,255,0.07)",pointerEvents:"none",
          top:[`8%`,`62%`,`80%`,`28%`,`72%`,`18%`][i], left:[`72%`,`4%`,`64%`,`12%`,`82%`,`44%`][i],
          animation:`bub ${[5,8,4,7,9,3.5][i]}s ease-in-out infinite`,animationDelay:`${i*0.6}s`}}/>
      ))}
      <div style={{textAlign:"center",position:"relative",zIndex:2}}>
        <div style={{display:"flex",gap:22,justifyContent:"center",marginBottom:18}}>
          {[0,1,2].map(i=>(
            <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <div style={{animation:`bob ${2.2+i*0.4}s ease-in-out infinite`,animationDelay:`${i*0.45}s`}}>
                <Avatar idx={i} isLL={i===1} size={68}/>
              </div>
              <span style={{fontSize:11,color:"rgba(255,255,255,0.92)",fontWeight:"bold",
                background:"rgba(0,0,0,0.18)",padding:"2px 8px",borderRadius:8,letterSpacing:1}}>
                {["你(农民)","地主老财","村姑"][i]}
              </span>
            </div>
          ))}
        </div>
        <h1 style={{fontSize:54,fontWeight:900,color:"#fff",margin:"0 0 6px",letterSpacing:10,
          textShadow:"0 4px 20px rgba(0,0,0,0.2)"}}>斗地主</h1>
        <p style={{color:"rgba(255,255,255,0.85)",fontSize:14,marginBottom:32,letterSpacing:4}}>
          经典三人扑克 · 智能AI对战 · 逆时针出牌
        </p>
        <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:32}}>
          {["♠A","♥K","♦Q","♣J"].map((s,i)=>(
            <div key={i} style={{
              width:50,height:68,background:"white",borderRadius:8,
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              boxShadow:"0 6px 20px rgba(0,0,0,0.2)",
              color:i===1||i===2?"#c0392b":"#1a1a2e",
              animation:`cf ${2.4+i*0.3}s ease-in-out infinite`,animationDelay:`${i*0.35}s`,
            }}>
              <div style={{fontSize:9,fontWeight:"bold",alignSelf:"flex-start",paddingLeft:5}}>{s[0]}</div>
              <div style={{fontSize:20}}>{s[0]}</div>
              <div style={{fontSize:13,fontWeight:900}}>{s.slice(1)}</div>
            </div>
          ))}
        </div>
        <button onClick={startGame} style={{
          background:"linear-gradient(135deg,#fff,#ffe8b0)",border:"none",borderRadius:50,
          padding:"16px 56px",fontSize:20,fontWeight:900,color:"#c0392b",
          cursor:"pointer",letterSpacing:5,fontFamily:"inherit",
          boxShadow:"0 6px 24px rgba(0,0,0,0.2)",
        }}>开始游戏</button>
      </div>
      <style>{`
        @keyframes bub{0%,100%{transform:translateY(0)}50%{transform:translateY(-16px)}}
        @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes cf{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-9px) rotate(2deg)}}
      `}</style>
    </div>
  );

  // ═══════════════════════════
  //  GAME SCREEN (bidding + playing + gameover)
  // ═══════════════════════════
  if (!G) return null;

  const myHand   = G.hands[0];
  const ai1Hand  = G.hands[1]; // left
  const ai2Hand  = G.hands[2]; // top
  const isBidding = G.phase==="bidding"||G.phase==="showkitty";
  const isPlaying = G.phase==="playing";
  const isOver    = G.phase==="gameover";
  const myTurn    = G.turn===0 && isPlaying;

  return (
    <div style={{
      minHeight:"100vh", maxWidth:480, margin:"0 auto",
      background:"linear-gradient(160deg,#fef9e7 0%,#fdebd0 45%,#e8f8f5 100%)",
      display:"flex",flexDirection:"column",
      fontFamily:"'Noto Serif SC','Georgia',serif",
      position:"relative", overflow:"hidden",
    }}>
      {/* dot bg */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none",opacity:0.032,
        backgroundImage:"radial-gradient(#c0392b 1px,transparent 1px)",backgroundSize:"26px 26px"}}/>

      {/* ── Header ── */}
      <div style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"10px 16px",
        background:"linear-gradient(90deg,#c0392b,#e74c3c)",
        boxShadow:"0 2px 12px rgba(192,57,43,0.4)",
        position:"relative",zIndex:10,flexShrink:0,
      }}>
        <span style={{color:"#fff",fontSize:18,fontWeight:900,letterSpacing:3}}>斗地主</span>
        <div style={{display:"flex",gap:8,fontSize:11,color:"rgba(255,255,255,0.92)"}}>
          {["你","左","上"].map((n,i)=>(
            <span key={i}>{n}:{scores[i]}{i<2&&<span style={{opacity:0.4}}> | </span>}</span>
          ))}
        </div>
        <button onClick={()=>{stopAI();setScreen("menu");}} style={{
          background:"rgba(255,255,255,0.18)",border:"1px solid rgba(255,255,255,0.35)",
          borderRadius:20,padding:"4px 12px",color:"white",fontSize:12,cursor:"pointer",fontFamily:"inherit",
        }}>返回</button>
      </div>

      {/* ── Kitty reveal overlay ── */}
      {G.showKitty && (
        <div style={{
          position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
          background:"rgba(255,255,255,0.97)",borderRadius:18,padding:"22px 36px",
          zIndex:200,textAlign:"center",border:"3px solid #f39c12",
          boxShadow:"0 10px 40px rgba(192,57,43,0.3)",
        }}>
          <div style={{color:"#c0392b",fontSize:16,fontWeight:900,marginBottom:14,letterSpacing:2}}>底牌揭晓 🎴</div>
          <div style={{display:"flex",gap:10,justifyContent:"center"}}>
            {G.kitty.map(c=><Card key={c.id} card={c}/>)}
          </div>
          <div style={{color:"#888",fontSize:13,marginTop:12}}>
            {G.landlord===0?"全归你了！":`归玩家${G.landlord+1}`}
          </div>
        </div>
      )}

      {/* ── Game over overlay ── */}
      {isOver && (
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.52)",zIndex:300,
          display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{
            background:"linear-gradient(135deg,#fff,#fff9e6)",borderRadius:24,padding:"36px 48px",
            textAlign:"center",border:"3px solid #f39c12",boxShadow:"0 12px 50px rgba(0,0,0,0.35)",minWidth:270,
          }}>
            <div style={{fontSize:58,marginBottom:10}}>
              {G.winner===0?"🏆": G.winner!==ll?"🎉":"😢"}
            </div>
            <div style={{fontSize:21,fontWeight:900,color:"#c0392b",marginBottom:8,letterSpacing:2}}>
              {G.winner===ll
                ? (G.winner===0?"你是地主，赢了！":`玩家${G.winner+1}地主胜！`)
                : (G.winner===0?"农民逆袭！你赢了！":"农民胜利！")}
            </div>
            <div style={{fontSize:13,color:"#888",marginBottom:24}}>
              你:{scores[0]} / 左:{scores[1]} / 上:{scores[2]}
            </div>
            <button onClick={startGame} style={{
              background:"linear-gradient(135deg,#c0392b,#e74c3c)",border:"none",borderRadius:50,
              padding:"13px 40px",fontSize:17,fontWeight:"bold",color:"white",
              cursor:"pointer",letterSpacing:3,fontFamily:"inherit",
              boxShadow:"0 4px 16px rgba(192,57,43,0.38)",
            }}>再来一局</button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          MIDDLE: left player(1) + CENTER TABLE + right player(2)
         ══════════════════════════════════════ */}
      <div style={{flex:1,display:"flex",alignItems:"stretch",position:"relative",zIndex:5,minHeight:220}}>

        {/* Left player (index 1) */}
        <div style={{
          width:84, background:"rgba(255,255,255,0.42)",
          borderRight:"1px solid rgba(0,0,0,0.06)",
          display:"flex", flexDirection:"column", alignItems:"center",
          padding:"10px 5px", gap:5, flexShrink:0,
        }}>
          <Avatar idx={1} isLL={ll===1} size={42} active={G.turn===1}/>
          <div style={{fontSize:11,fontWeight:"bold",color:ll===1?"#c0392b":"#2c3e50",textAlign:"center"}}>
            玩家2
            <div style={{fontSize:10,color:"#95a5a6",fontWeight:"normal"}}>{ll===1?"👑地主":"农民"}</div>
            <div style={{fontSize:10,color:"#95a5a6"}}>{ai1Hand.length}张</div>
          </div>
          {G.turn===1 && isPlaying && (
            <div style={{background:"#27ae60",color:"white",fontSize:10,padding:"2px 8px",
              borderRadius:8,fontWeight:"bold",animation:"blink 1s infinite"}}>出牌</div>
          )}
          {isBidding && G.bids[1]!==null && (
            <div style={{fontSize:10,padding:"2px 7px",borderRadius:8,
              background:G.bids[1]?"#ffeaa7":"#dfe6e9",color:G.bids[1]?"#c0392b":"#636e72",fontWeight:"bold"}}>
              {G.bids[1]?"叫地主":"不叫"}
            </div>
          )}
          <FaceDownFan count={ai1Hand.length} vertical/>
        </div>

        {/* ── CENTER TABLE: all played cards + status ── */}
        <div style={{
          flex:1, display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"space-between",
          padding:"8px 6px", gap:4,
        }}>
          {/* Kitty */}
          {isPlaying && (
            <div style={{display:"flex",gap:3,opacity:0.5,flexWrap:"wrap",justifyContent:"center"}}>
              {G.kitty.map(c=><Card key={c.id} card={c} sm/>)}
            </div>
          )}

          {/* ═══ THE SHARED PLAY AREA ═══ */}
          <div style={{
            flex:1, width:"100%",
            display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center",
            gap:6,
          }}>
            {/* Last play type badge */}
            {G.lastInfo && (
              <div style={{fontSize:12,color:"#c0392b",fontWeight:"bold",
                background:"rgba(192,57,43,0.08)",padding:"3px 14px",borderRadius:12,
                border:"1px solid rgba(192,57,43,0.18)"}}>
                {G.lastInfo.type==="rocket"?"🚀 火箭！":G.lastInfo.type==="bomb"?"💣 炸弹！":
                 G.lastInfo.type==="seq"?`顺子(${G.lastInfo.len}张)`:
                 G.lastInfo.type==="pairseq"?`连对(${G.lastInfo.len}对)`:
                 (G.lastInfo.type==="plane"||G.lastInfo.type==="plane1")?"✈️ 飞机！":""}
              </div>
            )}

            {/* Three rows: player2 played / player1 played / player0 played */}
            {/* Only show the most recent round — non-null entries */}
            <div style={{
              width:"100%",
              display:"flex", flexDirection:"column",
              alignItems:"center", gap:6,
            }}>
              {/* Player 2 row */}
              {G.table[2] && (
                <div style={{
                  display:"flex",alignItems:"center",gap:8,
                  background:"rgba(255,255,255,0.82)",borderRadius:12,
                  padding:"6px 12px",border:"1px solid rgba(0,0,0,0.06)",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.07)",width:"100%",
                  justifyContent:"center",
                }}>
                  <span style={{fontSize:11,color:"#888",whiteSpace:"nowrap",minWidth:36,textAlign:"right"}}>玩家3</span>
                  <Played cards={G.table[2]==="pass"?null:G.table[2]} passed={G.table[2]==="pass"}/>
                </div>
              )}
              {/* Player 1 row */}
              {G.table[1] && (
                <div style={{
                  display:"flex",alignItems:"center",gap:8,
                  background:"rgba(255,255,255,0.82)",borderRadius:12,
                  padding:"6px 12px",border:"1px solid rgba(0,0,0,0.06)",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.07)",width:"100%",
                  justifyContent:"center",
                }}>
                  <span style={{fontSize:11,color:"#888",whiteSpace:"nowrap",minWidth:36,textAlign:"right"}}>玩家2</span>
                  <Played cards={G.table[1]==="pass"?null:G.table[1]} passed={G.table[1]==="pass"}/>
                </div>
              )}
              {/* Player 0 row */}
              {G.table[0] && (
                <div style={{
                  display:"flex",alignItems:"center",gap:8,
                  background:"rgba(255,255,255,0.82)",borderRadius:12,
                  padding:"6px 12px",border:"1px solid rgba(0,0,0,0.06)",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.07)",width:"100%",
                  justifyContent:"center",
                }}>
                  <span style={{fontSize:11,color:"#888",whiteSpace:"nowrap",minWidth:24,textAlign:"right"}}>你</span>
                  <Played cards={G.table[0]==="pass"?null:G.table[0]} passed={G.table[0]==="pass"}/>
                </div>
              )}
            </div>
          </div>

          {/* Status message */}
          <div style={{
            fontSize:13,color:"#7f8c8d",background:"rgba(255,255,255,0.8)",
            padding:"5px 16px",borderRadius:16,border:"1px solid rgba(0,0,0,0.07)",
            textAlign:"center",flexShrink:0,
          }}>
            {isBidding && G.bidStep===0 ? "请叫地主" :
             isBidding ? `玩家${BID_ORDER[G.bidStep]+1}正在考虑...` :
             isPlaying && G.turn===0 ? (canPass?"选牌出牌 或 不出":"自由出牌！") :
             isPlaying ? `玩家${G.turn+1}正在出牌...` : ""}
          </div>

          {/* Bid buttons */}
          {isBidding && G.bidStep===0 && G.phase==="bidding" && (
            <div style={{display:"flex",gap:14,paddingBottom:4}}>
              <button onClick={()=>playerBid(1)} style={{
                background:"linear-gradient(135deg,#c0392b,#e74c3c)",border:"none",borderRadius:50,
                padding:"13px 28px",fontSize:16,fontWeight:900,color:"white",cursor:"pointer",
                letterSpacing:2,boxShadow:"0 3px 12px rgba(192,57,43,0.38)",fontFamily:"inherit",
              }}>叫地主</button>
              <button onClick={()=>playerBid(0)} style={{
                background:"rgba(0,0,0,0.07)",border:"1px solid rgba(0,0,0,0.15)",borderRadius:50,
                padding:"13px 28px",fontSize:16,color:"#636e72",cursor:"pointer",
                letterSpacing:2,fontFamily:"inherit",
              }}>不叫</button>
            </div>
          )}
        </div>

        {/* Right player (index 2) */}
        <div style={{
          width:84, background:"rgba(255,255,255,0.42)",
          borderLeft:"1px solid rgba(0,0,0,0.06)",
          display:"flex", flexDirection:"column", alignItems:"center",
          padding:"10px 5px", gap:5, flexShrink:0,
        }}>
          <Avatar idx={2} isLL={ll===2} size={42} active={G.turn===2}/>
          <div style={{fontSize:11,fontWeight:"bold",color:ll===2?"#c0392b":"#2c3e50",textAlign:"center"}}>
            玩家3
            <div style={{fontSize:10,color:"#95a5a6",fontWeight:"normal"}}>{ll===2?"👑地主":"农民"}</div>
            <div style={{fontSize:10,color:"#95a5a6"}}>{ai2Hand.length}张</div>
          </div>
          {G.turn===2 && isPlaying && (
            <div style={{background:"#27ae60",color:"white",fontSize:10,padding:"2px 8px",
              borderRadius:8,fontWeight:"bold",animation:"blink 1s infinite"}}>出牌</div>
          )}
          {isBidding && G.bids[2]!==null && (
            <div style={{fontSize:10,padding:"2px 7px",borderRadius:8,
              background:G.bids[2]?"#ffeaa7":"#dfe6e9",color:G.bids[2]?"#c0392b":"#636e72",fontWeight:"bold"}}>
              {G.bids[2]?"叫地主":"不叫"}
            </div>
          )}
          <FaceDownFan count={ai2Hand.length} vertical/>
        </div>
      </div>

      {/* ══════════════════════════════════════
          BOTTOM: PLAYER HAND
         ══════════════════════════════════════ */}
      <div style={{
        background:"linear-gradient(0deg,rgba(255,255,255,0.97),rgba(255,255,255,0.86))",
        borderTop:"2px solid rgba(192,57,43,0.2)",
        padding:"10px 14px 20px", position:"relative", zIndex:5,
        boxShadow:"0 -4px 20px rgba(0,0,0,0.08)", flexShrink:0,
      }}>
        {/* Player info row */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Avatar idx={0} isLL={ll===0} size={46} active={myTurn}/>
            <div>
              <div style={{fontSize:14,fontWeight:"bold",color:ll===0?"#c0392b":"#2c3e50"}}>
                你 {ll===0?"👑地主":"农民"}
              </div>
              <div style={{fontSize:12,color:"#95a5a6"}}>{myHand.length}张牌</div>
            </div>
            {myTurn && (
              <div style={{background:"#c0392b",color:"white",fontSize:11,padding:"3px 10px",
                borderRadius:10,fontWeight:"bold",animation:"blink 1s infinite"}}>你的回合</div>
            )}
          </div>
          {isBidding && G.bids[0]!==null && (
            <div style={{fontSize:13,padding:"4px 12px",borderRadius:10,
              background:G.bids[0]?"#ffeaa7":"#dfe6e9",color:G.bids[0]?"#c0392b":"#636e72",fontWeight:"bold"}}>
              {G.bids[0]?"叫地主":"不叫"}
            </div>
          )}
        </div>

        {/* Error */}
        {err && (
          <div style={{textAlign:"center",fontSize:13,color:"#c0392b",background:"rgba(192,57,43,0.07)",
            padding:"5px",borderRadius:8,marginBottom:6,border:"1px solid rgba(192,57,43,0.2)"}}>
            {err}
          </div>
        )}

        {/* ── Hand cards: scrollable fan ── */}
        <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:4}}>
          <div style={{
            display:"flex", justifyContent:"flex-start",
            paddingTop:26, paddingLeft:10, paddingRight:10,
            minWidth:"max-content",
          }}>
            {myHand.map((card,i)=>(
              <div key={card.id} style={{marginLeft:i===0?0:-20, zIndex:sel.has(card.id)?50:i}}>
                <Card card={card} sel={sel.has(card.id)}
                  onTap={isPlaying&&myTurn ? ()=>toggleCard(card) : undefined}/>
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons — large, elder-friendly */}
        {isPlaying && myTurn && (
          <div style={{display:"flex",gap:14,marginTop:14,justifyContent:"center"}}>
            {canPass && (
              <button onClick={playerPass} style={{
                background:"rgba(0,0,0,0.07)", border:"1px solid rgba(0,0,0,0.15)", borderRadius:50,
                padding:"13px 32px", fontSize:17, color:"#636e72", cursor:"pointer",
                letterSpacing:2, fontFamily:"inherit", fontWeight:"bold",
              }}>不出</button>
            )}
            <button onClick={playerPlay} disabled={sel.size===0} style={{
              background:sel.size>0?"linear-gradient(135deg,#c0392b,#e74c3c)":"rgba(0,0,0,0.07)",
              border:"none", borderRadius:50, padding:"13px 40px", fontSize:17, fontWeight:"bold",
              color:sel.size>0?"white":"#aaa", cursor:sel.size>0?"pointer":"not-allowed",
              letterSpacing:2, transition:"all 0.15s", fontFamily:"inherit",
              boxShadow:sel.size>0?"0 5px 16px rgba(192,57,43,0.38)":"none",
            }}>出牌{sel.size>0?` (${sel.size})`:""}</button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.45}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{height:3px}
        ::-webkit-scrollbar-thumb{background:rgba(192,57,43,0.3);border-radius:2px}
      `}</style>
    </div>
  );
}
