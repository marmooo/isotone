import { Midy } from "https://cdn.jsdelivr.net/gh/marmooo/midy@0.6.5/dist/midy.min.js";

function toggleDarkMode() {
  const html = document.documentElement;
  const newTheme = html.getAttribute("data-bs-theme") === "dark"
    ? "light"
    : "dark";
  html.setAttribute("data-bs-theme", newTheme);
  localStorage.setItem("darkMode", newTheme);
}

function toggleHandMode(event) {
  panel.classList.toggle("single");
  if (handMode === 1) {
    handMode = 2;
    event.target.textContent = "2️⃣";
  } else {
    handMode = 1;
    event.target.textContent = "1️⃣";
  }
}

function changeLang() {
  const langObj = document.getElementById("lang");
  const lang = langObj.options[langObj.selectedIndex].value;
  location.href = `/isotone/${lang}/`;
}

function getGlobalCSS() {
  let cssText = "";
  for (const stylesheet of document.styleSheets) {
    for (const rule of stylesheet.cssRules) {
      cssText += rule.cssText;
    }
  }
  const css = new CSSStyleSheet();
  css.replaceSync(cssText);
  return css;
}

function defineShadowElement(tagName, callback) {
  class ShadowElement extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [globalCSS];
      shadow.appendChild(
        document.getElementById(tagName).content.cloneNode(true),
      );
      callback?.(shadow, this);
    }
  }
  customElements.define(tagName, ShadowElement);
}

const globalCSS = getGlobalCSS();
defineShadowElement("midi-instrument", (shadow) => {
  shadow.querySelector("select").onchange = setProgramChange;
});
defineShadowElement("midi-drum", (shadow) => {
  shadow.querySelector("select").onchange = setProgramChange;
});

function setEffect(groupId, channel, value) {
  if (effectTypes[groupId] === "expression") {
    midy.setControlChange(channel, 11, value);
  } else {
    midy.setControlChange(channel, 74, value);
  }
}

async function setProgramChange(event) {
  const target = event.target;
  const host = target.getRootNode().host;
  const programNumber = target.selectedIndex;
  const channelNumber = (host.id === "instrument-first") ? 0 : 15;
  const channel = midy.channels[channelNumber];
  const bankNumber = channel.isDrum ? 128 : channel.bankLSB;
  const index = midy.soundFontTable[programNumber][bankNumber];
  if (index === undefined) {
    const bank = bankNumber.toString().padStart(3, "0");
    const program = programNumber.toString().padStart(3, "0");
    const path = `${soundFontURL}/${bank}/${program}.sf3`;
    await midy.loadSoundFont(path);
  }
  midy.setProgramChange(channelNumber, programNumber);
}

function getPointerArea(event) {
  return event.width * event.height;
}

function setPadColor(padHit, velocity) {
  const padView = padHit.parentNode.querySelector(".pad-view");
  if (velocity != null) {
    const lightness = 30 + (velocity / 127) * 40;
    padView.style.setProperty("background", `hsl(200, 80%, ${lightness}%)`);
  } else {
    padView.style.removeProperty("background");
  }
  return padView;
}

function highlightPad(padHit, velocity = 64) {
  setPadColor(padHit, velocity);
}

function clearPadColor(padHit) {
  setPadColor(padHit, null);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toMidiValue(ratio) {
  return Math.max(1, Math.round(ratio * 127));
}

function getCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getHitOrientation(padA, padB) {
  const c1 = getCenter(padA.getBoundingClientRect());
  const c2 = getCenter(padB.getBoundingClientRect());
  const dx = Math.abs(c1.x - c2.x);
  const dy = Math.abs(c1.y - c2.y);
  return dx > dy ? "horizontal" : "vertical";
}

function calcPitchBendRatio(event, padRect) {
  const inset = padRect.width * 0.1;
  const { clientX: x, clientY: y } = event;
  if (x < padRect.left) {
    return {
      ratio: clamp(1 + (x - padRect.left) / inset, 0, 1),
      direction: "horizontal",
    };
  }
  if (x > padRect.right) {
    return {
      ratio: clamp(1 + (padRect.right - x) / inset, 0, 1),
      direction: "horizontal",
    };
  }
  if (y < padRect.top) {
    return {
      ratio: clamp(1 + (y - padRect.top) / inset, 0, 1),
      direction: "vertical",
    };
  }
  if (y > padRect.bottom) {
    return {
      ratio: clamp(1 + (padRect.bottom - y) / inset, 0, 1),
      direction: "vertical",
    };
  }
  return null; // inside pad
}

function calcContinuousPitchBend(event, state) {
  const semitoneDiff = state.toNote - state.fromNote;
  let ratio = 1;
  if (state.targetPadHit && state.currentPadHit) {
    const fromRect = state.currentPadHit.getBoundingClientRect();
    const toRect = state.targetPadHit.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (state.bendDirection === "horizontal") {
      const left = Math.max(fromRect.left, toRect.left);
      const right = Math.min(fromRect.right, toRect.right);
      ratio = clamp((x - left) / (right - left), 0, 1);
    } else {
      const top = Math.max(fromRect.top, toRect.top);
      const bottom = Math.min(fromRect.bottom, toRect.bottom);
      ratio = clamp((y - top) / (bottom - top), 0, 1);
    }
  } else if (state.currentPadHit) {
    const padRect = state.currentPadHit.getBoundingClientRect();
    const result = calcPitchBendRatio(event, padRect);
    if (result) {
      ratio = result.ratio;
      state.bendDirection ??= result.direction;
    }
  } else {
    state.bendDirection = null;
  }
  const sensitivity =
    midy.channels[state.channelNumber].state.pitchWheelSensitivity *
    128 * 2;
  return Math.round(8192 + (8192 * semitoneDiff * ratio) / sensitivity);
}

function calcExpressionFromMovement(event, state) {
  if (!state.currentPadHit || !state.bendDirection) return null;
  const padRect = state.currentPadHit.parentNode.getBoundingClientRect();
  const ratio = state.bendDirection === "horizontal"
    ? 1 - clamp(event.clientY - padRect.top, 0, padRect.height) / padRect.height
    : clamp(event.clientX - padRect.left, 0, padRect.width) / padRect.width;
  return toMidiValue(ratio);
}

function calcVelocityFromY(event, padHit) {
  const rect = padHit.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const ratio = 1 - clamp(y / rect.height, 0, 1);
  return toMidiValue(ratio);
}

function calcInitialChordExpression(event, padA, padB) {
  const r1 = padA.getBoundingClientRect();
  const r2 = padB.getBoundingClientRect();
  const left = Math.min(r1.left, r2.left);
  const right = Math.max(r1.right, r2.right);
  const ratio = clamp((event.clientX - left) / (right - left), 0, 1);
  return Math.round(ratio * 127);
}

function createMPEPointerState(channelNumber, groupId) {
  return {
    groupId,
    channelNumber,
    baseNotes: new Set(),
    padHits: new Set(),
    baseCenterNote: null,
    chordExpression: 64,
    initialOrientation: null,
    currentPadHit: null,
    targetPadHit: null,
    fromNote: null,
    toNote: null,
    bendDirection: null,
    // aftertouch
    baseArea: 1,
    pressure: 0,
    pressureDirection: 0,
    pressureInterval: null,
    lastMoveTime: 0,
  };
}

function getOrCreateState(pointerId, groupId) {
  if (!mpePointers.has(pointerId)) {
    const channelNumber = midy.allocMPEChannel(groupId);
    if (channelNumber == null) return null;
    mpePointers.set(pointerId, createMPEPointerState(channelNumber, groupId));
  }
  return mpePointers.get(pointerId);
}

function handlePointerDown(event, panel, groupId) {
  if (!isInsidePanel(event)) return;
  panel.setPointerCapture(event.pointerId);
  if (mpePointers.has(event.pointerId)) {
    handlePointerUp(event, panel);
  }
  const hits = document.elementsFromPoint(event.clientX, event.clientY)
    .filter((el) => el.classList?.contains("pad-hit"));
  if (hits.length === 0 || hits.length > 2) return;
  const state = getOrCreateState(event.pointerId, groupId);
  if (!state) return;
  if (hits.length === 2) {
    state.initialOrientation = getHitOrientation(hits[0], hits[1]);
    if (state.initialOrientation === "vertical") {
      state.chordExpression = calcInitialChordExpression(
        event,
        hits[0],
        hits[1],
      );
      setEffect(groupId, state.channelNumber, state.chordExpression);
    }
  }
  for (const padHit of hits) {
    activatePad(event, padHit, state);
  }
  mpeHitMap.set(event.pointerId, new Set(hits));
}

function activatePad(event, padHit, state) {
  padHit.setPointerCapture(event.pointerId);
  const note = Number(padHit.dataset.index);
  if (state.baseNotes.has(note)) return;
  if (state.baseNotes.size === 0) {
    if (state.initialOrientation !== "vertical") {
      state.chordExpression = calcVelocityFromY(event, padHit);
    }
    setEffect(state.groupId, state.channelNumber, state.chordExpression);
    if (afterTouchEnabled) {
      state.baseArea = getPointerArea(event);
      state.pressure = 0;
      state.pressureDirection = 0;
      midy.setChannelPressure(state.channelNumber, 0);
      state.pressureInterval = setInterval(() => {
        const next = clamp(state.pressure + state.pressureDirection, 0, 127);
        if (next === state.pressure) return;
        state.pressure = next;
        midy.setChannelPressure(state.channelNumber, state.pressure);
      }, 0);
    }
  }
  highlightPad(padHit, state.chordExpression);
  if (state.baseCenterNote == null) {
    state.baseCenterNote = note;
    if (bendEnabled[state.groupId]) {
      midy.channels[state.channelNumber].setPitchBendRange(8192);
    }
  }
  midy.noteOn(state.channelNumber, note, 127);
  state.baseNotes.add(note);
  state.padHits.add(padHit);
  state.currentPadHit = padHit;
  state.fromNote = state.baseCenterNote ?? note;
  state.toNote = note;
}

function syncNoteOnMove(event, state, hits) {
  const hitMap = new Map(hits.map((h) => [Number(h.dataset.index), h]));
  for (const note of [...state.baseNotes]) {
    if (!hitMap.has(note)) {
      midy.noteOff(state.channelNumber, note);
      state.baseNotes.delete(note);
    }
  }
  for (const [note] of hitMap) {
    if (!state.baseNotes.has(note)) {
      midy.noteOn(state.channelNumber, note, 127);
      state.baseNotes.add(note);
    }
  }
  state.currentPadHit = hits[0] ?? state.currentPadHit;
  state.bendDirection = state.baseNotes.size > 1
    ? state.initialOrientation
    : "horizontal"; // keeps the vertical axis driving expression
  const expression = calcExpressionFromMovement(event, state);
  const vel = expression ?? state.chordExpression;
  if (expression !== null) {
    state.chordExpression = expression;
    setEffect(state.groupId, state.channelNumber, expression);
  }
  hits.forEach((p) => highlightPad(p, vel));
}

function handlePointerMove(event) {
  const state = mpePointers.get(event.pointerId);
  if (!state) return;
  if (afterTouchEnabled) {
    const now = event.timeStamp;
    state.lastMoveTime = now;
    const area = getPointerArea(event);
    state.pressureDirection = state.baseArea < area ? 1 : -1;
  }
  const hits = document.elementsFromPoint(event.clientX, event.clientY)
    .filter((el) => el.classList?.contains("pad-hit"));
  const newHitSet = new Set(hits);
  for (const padHit of state.padHits) {
    if (!newHitSet.has(padHit)) clearPadColor(padHit);
  }
  state.padHits = newHitSet;
  mpeHitMap.set(event.pointerId, newHitSet);
  if (!bendEnabled[state.groupId]) {
    syncNoteOnMove(event, state, hits);
    return;
  }
  if (hits.length === 2 && state.baseNotes.size === 1) {
    const padA = hits.find((p) => Number(p.dataset.index) === state.fromNote);
    const padB = hits.find((p) => Number(p.dataset.index) !== state.fromNote);
    if (padA && padB) {
      state.currentPadHit = padA;
      state.targetPadHit = padB;
      state.toNote = Number(padB.dataset.index);
      state.bendDirection = getHitOrientation(padA, padB);
    }
  } else if (hits.length === 1) {
    const note = Number(hits[0].dataset.index);
    state.currentPadHit = hits[0];
    state.targetPadHit = null;
    state.toNote = note;
  } else if (hits.length === 0) {
    state.currentPadHit = null;
    state.targetPadHit = null;
    state.toNote = state.fromNote;
  }
  if (state.baseNotes.size > 1 && hits.length >= 1) {
    state.currentPadHit = hits[0];
    state.bendDirection = state.initialOrientation;
    const expression = calcExpressionFromMovement(event, state);
    const vel = expression ?? state.chordExpression;
    if (expression !== null) {
      setEffect(state.groupId, state.channelNumber, expression);
    }
    hits.forEach((p) => highlightPad(p, vel));
  } else {
    const bend = calcContinuousPitchBend(event, state);
    midy.setPitchBend(state.channelNumber, bend);
    const expression = calcExpressionFromMovement(event, state);
    const vel = expression ?? state.chordExpression;
    if (expression !== null) {
      setEffect(state.groupId, state.channelNumber, expression);
    }
    hits.forEach((p) => highlightPad(p, vel));
  }
}

function handlePointerUp(event, panel) {
  const state = mpePointers.get(event.pointerId);
  if (state) {
    if (state.pressureInterval !== null) {
      clearInterval(state.pressureInterval);
      state.pressureInterval = null;
    }
    state.padHits.forEach(clearPadColor);
    state.baseNotes.forEach((note) => midy.noteOff(state.channelNumber, note));
    midy.setPitchBend(state.channelNumber, 8192);
    midy.setChannelPressure(state.channelNumber, 0);
    midy.releaseMPEChannel(state.channelNumber);
    mpePointers.delete(event.pointerId);
  }
  if (mpeHitMap.has(event.pointerId)) {
    mpeHitMap.get(event.pointerId).clear();
    mpeHitMap.delete(event.pointerId);
  }
  try {
    panel.releasePointerCapture(event.pointerId);
  } catch { /* skip */ }
}

function setMPEKeyEvents(panel, groupId) {
  panel.addEventListener(
    "pointerdown",
    (event) => handlePointerDown(event, panel, groupId),
  );
  panel.addEventListener("pointermove", handlePointerMove);
  panel.addEventListener("pointerup", (event) => handlePointerUp(event, panel));
  panel.addEventListener(
    "pointercancel",
    (event) => handlePointerUp(event, panel),
  );
}

function isInsidePanel(event) {
  const rect = panel.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

function getTranslatedLabel(engLabel) {
  if (engLabel === "⬇" || engLabel === "⬆") return engLabel;
  const map = noteMap[htmlLang];
  return map[engLabel[0]] + engLabel.slice(1);
}

function parseNote(note) {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) throw new Error(`Invalid note: ${note}`);
  return { name: match[1].toUpperCase(), octave: parseInt(match[2], 10) };
}

function toNoteNumber(note) {
  const match = note.match(/^([A-Ga-g])([#b]?)(\d+)$/);
  if (!match) return -1;
  const pitchMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let n = pitchMap[match[1].toUpperCase()];
  if (match[2] === "#") n += 1;
  if (match[2] === "b") n -= 1;
  return n + (parseInt(match[3]) + 1) * 12;
}

function initButtons() {
  const allKeys = [[], []];
  document.querySelectorAll(".group").forEach((group, groupId) => {
    const octaveButtons = [];
    for (const label of baseLabels) {
      const noteNumber = toNoteNumber(label);
      const button = document.createElement("div");
      button.role = "button";
      button.setAttribute("aria-pressed", "false");
      if (0 <= noteNumber) {
        button.className = label.includes("#")
          ? "bg-dark-subtle border rounded pad"
          : "bg-light-subtle border rounded pad";
        const padHit = document.createElement("div");
        padHit.className = "pad-hit";
        padHit.dataset.index = noteNumber.toString();
        const padView = document.createElement("div");
        padView.className = "pad-view";
        padView.textContent = getTranslatedLabel(label);
        padView.name = label;
        button.append(padHit, padView);
        setMPEKeyEvents(padHit, groupId);
        allKeys[groupId].push(button);
      } else {
        button.className = label === "⬆"
          ? "btn btn-outline-primary pad"
          : "btn btn-outline-danger pad";
        button.textContent = label;
        button.name = label;
        octaveButtons.push(button);
      }
      group.appendChild(button);
    }
    octaveButtons.forEach((btn) => setChangeOctaveEvents(groupId, btn));
  });
  return allKeys;
}

function setChangeOctaveEvents(groupId, octaveButton) {
  octaveButton.addEventListener("pointerdown", () => {
    const direction = octaveButton.name === "⬆" ? 1 : -1;
    const nextOctave = currOctaves[groupId] + direction;
    if (nextOctave <= 0 || nextOctave >= 11) return;
    currOctaves[groupId] = nextOctave;
    for (const button of allKeys[groupId]) {
      const padView = button.querySelector(".pad-view");
      const padHit = button.querySelector(".pad-hit");
      const { name, octave } = parseNote(padView.name);
      const newLabel = `${name}${octave + direction}`;
      padView.name = newLabel;
      padView.textContent = getTranslatedLabel(newLabel);
      padHit.dataset.index = (Number(padHit.dataset.index) + direction * 12)
        .toString();
    }
  });
}

function initConfig() {
  const ccHandlers = [
    (ch, v) => midy.setControlChange(ch, 1, v),
    (ch, v) => midy.setControlChange(ch, 76, v),
    (ch, v) => midy.setControlChange(ch, 77, v),
    (ch, v) => midy.setControlChange(ch, 78, v),
    (ch, v) => midy.setControlChange(ch, 91, v),
    (ch, v) => midy.setControlChange(ch, 93, v),
  ];
  document.getElementById("config").querySelectorAll("div.col")
    .forEach((config, groupId) => {
      const channelNumber = groupId === 0 ? 0 : 15;
      initMode(config, groupId);
      initEffect(config, groupId);
      initDrumToggle(config, channelNumber);
      initRangeControls(config, channelNumber, ccHandlers);
    });
}

function initMode(config, groupId) {
  const form = config.querySelectorAll("form")[0];
  form.addEventListener("change", (event) => {
    bendEnabled[groupId] = event.target.value === "bend";
  });
}

function initEffect(config, groupId) {
  const form = config.querySelector("form");
  form.addEventListener("change", (event) => {
    effectTypes[groupId] = event.target.value;
  });
}

function initDrumToggle(config, channelNumber) {
  const checkbox = config.querySelector("input[role=switch]");
  checkbox.addEventListener("change", (event) => {
    config.querySelector("midi-instrument").parentNode
      .classList.toggle("d-none");
    if (event.target.checked) {
      midy.setControlChange(channelNumber, 0, 120); // bankMSB
      midy.setProgramChange(channelNumber, 0);
    } else {
      midy.setControlChange(channelNumber, 0, 121); // bankMSB
      const select = config.querySelector("midi-instrument").shadowRoot
        .querySelector("select");
      select.selectedIndex = 0;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

function initRangeControls(config, channelNumber, ccHandlers) {
  config.querySelectorAll("input[type=range]").forEach((input, j) => {
    const handler = ccHandlers[j];
    if (!handler) return;
    input.addEventListener("change", (event) => {
      handler(channelNumber, event.target.value);
    });
  });
}

const mpeHitMap = new Map();
const mpePointers = new Map();

// deno-fmt-ignore
const baseLabels = [
  "C4",  "D4",  "C#4", "D#4", "⬇",
  "E4",  "F4",  "F#4", "G#4", "⬇",
  "G4",  "A4",  "B4",  "A#4", "⬇",
  "C5",  "D5",  "C#5", "D#5", "⬆",
  "E5",  "F5",  "F#5", "G#5", "⬆",
  "G5",  "A5",  "B5",  "A#5", "⬆",
];
const htmlLang = document.documentElement.lang;
const noteMap = {
  ja: { C: "ド", D: "レ", E: "ミ", F: "ファ", G: "ソ", A: "ラ", B: "シ" },
  en: { C: "C", D: "D", E: "E", F: "F", G: "G", A: "A", B: "B" },
};

const afterTouchEnabled = true;
const currOctaves = [4, 4];
const effectTypes = ["expression", "expression"];
const bendEnabled = [true, true];
let handMode = 1;

const panel = document.getElementById("panel");
const allKeys = initButtons();

const soundFontURL = "https://soundfonts.pages.dev/GeneralUser_GS_v2.0.3";
const audioContext = new AudioContext();
const midy = new Midy(audioContext);
await Promise.all([
  midy.loadSoundFont(`${soundFontURL}/000/000.sf3`),
  midy.loadSoundFont(`${soundFontURL}/128/000.sf3`),
]);
for (let i = 0; i < 16; i++) {
  midy.channels[i].setPitchBendRange(1200);
}
midy.channels[9].setBankMSB(121);
midy.setProgramChange(9, 0);
midy.setMIDIPolyphonicExpression(0, 7);
midy.setMIDIPolyphonicExpression(15, 7);
initConfig();

document.getElementById("toggleDarkMode").onclick = toggleDarkMode;
document.getElementById("toggleHandMode").onclick = toggleHandMode;
document.getElementById("lang").onchange = changeLang;
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    if (midy.audioContext.state === "running") {
      await midy.audioContext.suspend();
    }
  } else {
    if (midy.audioContext.state === "suspended") {
      await midy.audioContext.resume();
    }
  }
});
if (CSS.supports("-webkit-touch-callout: default")) { // iOS
  // prevent double click zoom
  document.addEventListener("dblclick", (event) => event.preventDefault());
  // prevent text selection
  const preventDefault = (event) => event.preventDefault();
  const panel = document.getElementById("panel");
  panel.addEventListener("touchstart", () => {
    document.addEventListener("touchstart", preventDefault, {
      passive: false,
    });
  });
  panel.addEventListener("touchend", () => {
    document.removeEventListener("touchstart", preventDefault, {
      passive: false,
    });
  });
}
