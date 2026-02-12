import { Midy } from "https://cdn.jsdelivr.net/gh/marmooo/midy@0.4.6/dist/midy.min.js";

loadConfig();

function loadConfig() {
  if (localStorage.getItem("darkMode") == 1) {
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }
}

function toggleDarkMode() {
  if (localStorage.getItem("darkMode") == 1) {
    localStorage.setItem("darkMode", 0);
    document.documentElement.setAttribute("data-bs-theme", "light");
  } else {
    localStorage.setItem("darkMode", 1);
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }
}

function toggleHandMode(event) {
  panel.classList.toggle("single");
  if (handMode === 1) {
    handMode = 2;
    event.target.textContent = "2⃣";
  } else {
    handMode = 1;
    event.target.textContent = "1⃣";
  }
}

function changeLang() {
  const langObj = document.getElementById("lang");
  const lang = langObj.options[langObj.selectedIndex].value;
  location.href = `/isotone/${lang}/`;
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
    const program = programNumber.toString().padStart(3, "0");
    const baseName = bankNumber === 128 ? "128" : program;
    const path = `${soundFontURL}/${baseName}.sf3`;
    await midy.loadSoundFont(path);
  }
  midy.setProgramChange(channelNumber, programNumber);
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

function initMIDIInstrumentElement() {
  class MIDIInstrument extends HTMLElement {
    constructor() {
      super();
      const template = document.getElementById("midi-instrument");
      const shadow = this.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [globalCSS];
      shadow.appendChild(template.content.cloneNode(true));

      const select = shadow.querySelector("select");
      select.onchange = setProgramChange;
    }
  }
  customElements.define("midi-instrument", MIDIInstrument);
}

function initMIDIDrumElement() {
  class MIDIDrum extends HTMLElement {
    constructor() {
      super();
      const template = document.getElementById("midi-drum");
      const shadow = this.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [globalCSS];
      shadow.appendChild(template.content.cloneNode(true));

      const select = shadow.querySelector("select");
      select.onchange = setProgramChange;
    }
  }
  customElements.define("midi-drum", MIDIDrum);
}

const globalCSS = getGlobalCSS();
initMIDIInstrumentElement();
initMIDIDrumElement();

function setKeyColor(key, velocity, isActive) {
  if (isActive) {
    const lightness = 30 + (velocity / 127) * 40;
    const color = `hsl(200, 80%, ${lightness}%)`;
    key.style.setProperty("background", color);
  } else {
    key.style.removeProperty("background");
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toMidiValue(ratio) {
  return Math.max(1, Math.round(ratio * 127));
}

function calcPitchBendRatio(event, padRect, inset) {
  const { clientX: x, clientY: y } = event;
  let ratio = 0;
  let isOutside = false;
  let direction = null;
  if (x < padRect.left) {
    ratio = 1 + (x - padRect.left) / inset;
    isOutside = true;
    direction = "horizontal";
  } else if (x > padRect.right) {
    ratio = 1 + (padRect.right - x) / inset;
    isOutside = true;
    direction = "horizontal";
  } else if (y < padRect.top) {
    ratio = 1 + (y - padRect.top) / inset;
    isOutside = true;
    direction = "vertical";
  } else if (y > padRect.bottom) {
    ratio = 1 + (padRect.bottom - y) / inset;
    isOutside = true;
    direction = "vertical";
  }
  return {
    ratio: clamp(ratio, 0, 1),
    isOutside,
    direction,
  };
}

function calcContinuousPitchBend(event, state) {
  const semitoneDiff = state.toNote - state.fromNote;
  let ratio = 1;
  if (state.targetPadHit && state.currentPadHit) {
    const fromRect = state.currentPadHit.getBoundingClientRect();
    const toRect = state.targetPadHit.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (state.bendDirection === "horizontal") {
      const overlapLeft = Math.max(fromRect.left, toRect.left);
      const overlapRight = Math.min(fromRect.right, toRect.right);
      const overlapWidth = overlapRight - overlapLeft;
      const relativeX = x - overlapLeft;
      ratio = clamp(relativeX / overlapWidth, 0, 1);
    } else if (state.bendDirection === "vertical") {
      const overlapTop = Math.max(fromRect.top, toRect.top);
      const overlapBottom = Math.min(fromRect.bottom, toRect.bottom);
      const overlapHeight = overlapBottom - overlapTop;
      const relativeY = y - overlapTop;
      ratio = clamp(relativeY / overlapHeight, 0, 1);
    }
  } else if (state.currentPadHit) {
    const padRect = state.currentPadHit.getBoundingClientRect();
    const inset = padRect.width * 0.1;
    const result = calcPitchBendRatio(event, padRect, inset);
    ratio = result.isOutside ? result.ratio : 1;
    if (!state.bendDirection) {
      state.bendDirection = result.isOutside ? result.direction : null;
    }
  } else {
    state.bendDirection = null;
  }
  const channel = midy.channels[state.channel];
  const sensitivityInSemitones = channel.state.pitchWheelSensitivity * 128 * 2;
  const bend = Math.round(
    8192 + 8192 * semitoneDiff * ratio / sensitivityInSemitones,
  );
  return bend;
}

function calcExpressionFromMovement(event, state) {
  if (!state.currentPadHit || !state.bendDirection) return null;
  const padRect = state.currentPadHit.parentNode.getBoundingClientRect();
  const x = event.clientX;
  const y = event.clientY;
  let ratio;
  if (state.bendDirection === "horizontal") {
    const relativeY = clamp(y - padRect.top, 0, padRect.height);
    ratio = 1 - (relativeY / padRect.height);
  } else {
    const relativeX = clamp(x - padRect.left, 0, padRect.width);
    ratio = relativeX / padRect.width;
  }
  return toMidiValue(ratio);
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

function createMPEPointerState(channel) {
  return {
    channel,
    baseNotes: new Set(),
    padHits: new Set(),
    baseCenterNote: null,
    chordExpression: 64,
    initialOrientation: null,
    currentPadHit: null,
    targetPadHit: null,
    fromNote: null,
    toNote: null,
    bendPadRect: null,
    activeView: null,
    bendDirection: null,
  };
}

function highlightPad(padHit, velocity = 64) {
  const padView = padHit.parentNode.querySelector(".pad-view");
  setKeyColor(padView, velocity, true);
  return padView;
}

function clearPadColor(padHit) {
  const padView = padHit.parentNode.querySelector(".pad-view");
  padView.style.removeProperty("background");
}

function mpePointerDown(event, padHit, groupId) {
  padHit.setPointerCapture(event.pointerId);
  let state = mpePointers.get(event.pointerId);
  if (!state) {
    const channel = allocChannel(groupId);
    if (channel == null) return;
    state = createMPEPointerState(channel);
    mpePointers.set(event.pointerId, state);
  }
  const note = Number(padHit.dataset.index);
  if (state.baseNotes.has(note)) return;
  if (state.baseNotes.size === 0) {
    if (state.initialOrientation !== "vertical") {
      state.chordExpression = calcVelocityFromY(event, padHit);
    }
    midy.setControlChange(state.channel, 11, state.chordExpression);
  }
  state.activeView = highlightPad(padHit, state.chordExpression);
  if (state.baseCenterNote == null) {
    state.baseCenterNote = note;
    midy.setPitchBend(state.channel, 8192);
  }
  midy.noteOn(state.channel, note, 127);
  state.baseNotes.add(note);
  state.padHits.add(padHit);
  state.currentPadHit = padHit;
  state.fromNote = state.baseCenterNote ?? note;
  state.toNote = note;
  state.bendPadRect = padHit.getBoundingClientRect();
}

function mpePointerUp(event) {
  const state = mpePointers.get(event.pointerId);
  if (!state) return;
  state.padHits.forEach(clearPadColor);
  state.baseNotes.forEach((note) => midy.noteOff(state.channel, note));
  releaseChannel(state.channel);
  mpePointers.delete(event.pointerId);
}

function handlePointerDown(event, panel, groupId) {
  if (!isInsidePanel(event)) return;
  panel.setPointerCapture(event.pointerId);
  const hits = document.elementsFromPoint(event.clientX, event.clientY)
    .filter((el) => el.classList?.contains("pad-hit"));
  if (hits.length === 0 || hits.length > 2) return;
  let state = mpePointers.get(event.pointerId);
  if (!state) {
    const channel = allocChannel(groupId);
    if (channel == null) return;
    state = createMPEPointerState(channel);
    mpePointers.set(event.pointerId, state);
  }
  if (hits.length === 2) {
    state.initialOrientation = getHitOrientation(hits[0], hits[1]);
    if (state.initialOrientation === "vertical") {
      state.chordExpression = calcInitialChordExpression(
        event,
        hits[0],
        hits[1],
      );
      midy.setControlChange(state.channel, 11, state.chordExpression);
    }
  }
  hits.forEach((padHit) => mpePointerDown(event, padHit, groupId));
  mpeHitMap.set(event.pointerId, new Set(hits));
}

function handlePointerMove(event) {
  const state = mpePointers.get(event.pointerId);
  if (!state) return;
  const hits = document.elementsFromPoint(event.clientX, event.clientY)
    .filter((el) => el.classList?.contains("pad-hit"));
  const newHitSet = new Set(hits);
  mpeHitMap.set(event.pointerId, newHitSet);
  state.padHits.forEach((padHit) => {
    if (!newHitSet.has(padHit)) clearPadColor(padHit);
  });
  if (hits.length === 2 && state.baseNotes.size === 1) {
    const pad = hits.find((p) => Number(p.dataset.index) !== state.fromNote);
    if (pad) {
      state.toNote = Number(pad.dataset.index);
      const padA = hits.find((p) => Number(p.dataset.index) === state.fromNote);
      if (padA) {
        state.currentPadHit = padA;
        state.targetPadHit = pad;
        state.bendDirection = getHitOrientation(padA, pad);
      }
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
    if (expression !== null) {
      midy.setControlChange(state.channel, 11, expression);
      hits.forEach((padHit) => highlightPad(padHit, expression));
    } else {
      hits.forEach((padHit) => highlightPad(padHit, state.chordExpression));
    }
    state.padHits = newHitSet;
    return;
  }
  const bend = calcContinuousPitchBend(event, state);
  if (bend !== undefined) {
    midy.setPitchBend(state.channel, bend);
    const expression = calcExpressionFromMovement(event, state);
    if (expression !== null) {
      midy.setControlChange(state.channel, 11, expression);
      hits.forEach((padHit) => highlightPad(padHit, expression));
    } else {
      hits.forEach((padHit) => highlightPad(padHit, state.chordExpression));
    }
  } else {
    hits.forEach((padHit) => highlightPad(padHit, state.chordExpression));
  }
  state.padHits = newHitSet;
}

function handlePointerUp(event, panel) {
  if (!mpeHitMap.has(event.pointerId)) return;
  mpePointerUp(event);
  mpeHitMap.get(event.pointerId).clear();
  mpeHitMap.delete(event.pointerId);
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

function setChangeOctaveEvents(groupId, octaveButton) {
  octaveButton.addEventListener("pointerdown", () => {
    const direction = (octaveButton.name === "⬆") ? 1 : -1;
    const nextOctave = currOctaves[groupId] + direction;
    if (nextOctave <= 0 || 11 <= nextOctave) return;
    currOctaves[groupId] = nextOctave;
    const buttons = allKeys[groupId];
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      const padView = button.querySelector(".pad-view");
      const padHit = button.querySelector(".pad-hit");
      const noteNumber = Number(padHit.dataset.index);
      const { name, octave } = parseNote(padView.name);
      const newNameEn = `${name}${octave + direction}`;
      padView.name = newNameEn;
      padView.textContent = getTranslatedLabel(newNameEn);
      padHit.dataset.index = (noteNumber + direction * 12).toString();
    }
  });
}

function parseNote(note) {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const [, name, octave] = match;
  return {
    name: name.toUpperCase(),
    octave: parseInt(octave, 10),
  };
}

function toNoteNumber(note) {
  const regex = /^([A-Ga-g])([#b]?)(\d+)$/;
  const match = note.match(regex);
  if (!match) return -1;
  let [, pitch, accidental, octave] = match;
  pitch = pitch.toUpperCase();
  octave = parseInt(octave);
  const pitchMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let noteNumber = pitchMap[pitch];
  if (accidental === "#") noteNumber += 1;
  if (accidental === "b") noteNumber -= 1;
  noteNumber += (octave + 1) * 12;
  return noteNumber;
}

function initButtons() {
  const allKeys = [[], []];
  document.querySelectorAll(".group").forEach((group, groupId) => {
    const octaveButtons = [];
    for (let j = 0; j < baseLabels.length; j++) {
      const label = baseLabels[j];
      const noteNumber = toNoteNumber(label);
      const button = document.createElement("div");
      button.role = "button";
      button.setAttribute("aria-pressed", "false");
      if (0 <= noteNumber) {
        if (label.includes("#")) {
          button.className = "bg-dark-subtle border rounded pad";
        } else {
          button.className = "bg-light-subtle border rounded pad";
        }
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
        if (label === "⬆") {
          button.className = "btn btn-outline-primary pad";
        } else {
          button.className = "btn btn-outline-danger pad";
        }
        button.textContent = label;
        button.name = label;
        octaveButtons.push(button);
      }
      group.appendChild(button);
    }
    for (let j = 0; j < octaveButtons.length; j++) {
      const btn = octaveButtons[j];
      setChangeOctaveEvents(groupId, btn);
    }
  });
  return allKeys;
}

function initConfig() {
  const handlers = [
    (i, v) => midy.setControlChange(i, 1, v),
    (i, v) => midy.setControlChange(i, 76, v),
    (i, v) => midy.setControlChange(i, 77, v),
    (i, v) => midy.setControlChange(i, 78, v),
    (i, v) => midy.setControlChange(i, 91, v),
    (i, v) => midy.setControlChange(i, 93, v),
  ];
  const configs = document.getElementById("config").querySelectorAll("div.col");
  configs.forEach((config, i) => {
    const channelNumber = (i == 0) ? 0 : 15;
    const drum = config.querySelector("input[type=checkbox]");
    drum.addEventListener("change", (event) => {
      const instrument = config.querySelector("midi-instrument");
      instrument.parentNode.classList.toggle("d-none");
      if (event.target.checked) {
        midy.setControlChange(channelNumber, 0, 120); // bankMSB
        midy.setProgramChange(channelNumber, 0);
      } else {
        midy.setControlChange(channelNumber, 0, 121); // bankMSB
        const select = instrument.shadowRoot.querySelector("select");
        select.selectedIndex = 0;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const inputs = config.querySelectorAll("input[type=range]");
    inputs.forEach((input, j) => {
      const handler = handlers[j];
      if (!handler) return;
      input.addEventListener("change", (event) => {
        handler(channelNumber, event.target.value);
      });
    });
  });
}

const lowerFreeChannels = new Array(7);
const upperFreeChannels = new Array(7);
for (let i = 0; i < 7; i++) {
  lowerFreeChannels[i] = i + 1;
  upperFreeChannels[i] = i + 8;
}

function allocChannel(groupId) {
  if (groupId === 0) return lowerFreeChannels.shift() ?? null;
  if (groupId === 1) return upperFreeChannels.shift() ?? null;
  return null;
}

function releaseChannel(channelNumber) {
  if (1 <= channelNumber && channelNumber <= midy.lowerMPEMembers) {
    lowerFreeChannels.push(channelNumber);
    return;
  }
  if (15 - midy.upperMPEMembers <= channelNumber && channelNumber <= 14) {
    upperFreeChannels.push(channelNumber);
  }
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
const currOctaves = [4, 4];
let handMode = 1;

const panel = document.getElementById("panel");
const allKeys = initButtons();

const soundFontURL = "https://soundfonts.pages.dev/GeneralUser_GS_v1.471";
const audioContext = new AudioContext();
const midy = new Midy(audioContext);
await Promise.all([
  midy.loadSoundFont(`${soundFontURL}/000.sf3`),
  midy.loadSoundFont(`${soundFontURL}/128.sf3`),
]);
for (let i = 0; i < 16; i++) {
  midy.setPitchBendRange(i, 1200);
}
midy.setBankMSB(9, 121);
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
