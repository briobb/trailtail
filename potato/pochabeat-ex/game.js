const audioFile = "./ぽっちゃん注意報.mp3";
const titleScreen = document.querySelector("#title-screen");
const gameScreen = document.querySelector("#game-screen");
const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d");
const startButton = document.querySelector("#start");
const scoreEl = document.querySelector("#score");
const comboEl = document.querySelector("#combo");
const bestEl = document.querySelector("#best");
const progressEl = document.querySelector("#progress");
const hitFlash = document.querySelector("#hit-flash");
const screenFlash = document.querySelector("#screen-flash");
const judgementPop = document.querySelector("#judgement-pop");
const comboPop = document.querySelector("#combo-pop");
const resultLabel = document.querySelector("#result-label");
const laneButtons = [...document.querySelectorAll(".lane-key")];
const songButtons = [...document.querySelectorAll(".song-card.is-ready")];

const keys = new Map([
  ["d", 0],
  ["f", 1],
  ["j", 2],
  ["k", 3],
]);

const laneColors = ["#ff5f9b", "#ffd166", "#37ddb5", "#4cc9f0"];
const horizonImage = new Image();
horizonImage.src = "./images/bg.png";
horizonImage.addEventListener("load", () => {
  if (!state.running) drawIdle();
});
const sideImage = new Image();
sideImage.src = "./images/side.png";
sideImage.addEventListener("load", () => {
  if (!state.running) drawIdle();
});

const spaceStars = Array.from({ length: 120 }, (_, index) => ({
  angle: (index * 137.508 * Math.PI) / 180,
  radius: 0.18 + ((index * 0.731) % 1) * 1.08,
  depth: (index * 0.173) % 1,
  speed: (0.0038 + (index % 9) * 0.00055) * 1.4,
  size: 0.55 + (index % 5) * 0.22,
  color: index % 4 === 0 ? "#2de2ff" : index % 4 === 1 ? "#ff3ea5" : index % 4 === 2 ? "#ffe66d" : "#ffffff",
}));

const state = {
  audioContext: null,
  buffer: null,
  source: null,
  notes: [],
  sections: [],
  startTime: 0,
  startPerf: 0,
  visualTime: 0,
  score: 0,
  combo: 0,
  best: Number(localStorage.getItem("sakura-rhythm-best") || 0),
  running: false,
  finished: false,
  loop: null,
  perfectClear: true,
};

bestEl.textContent = state.best.toLocaleString();
resizeCanvas();
drawIdle();

window.addEventListener("resize", () => {
  resizeCanvas();
  if (!state.running) drawIdle();
});

startButton.addEventListener("click", startGame);

songButtons.forEach((button) => {
  button.addEventListener("click", () => {
    titleScreen.classList.add("is-hidden");
    gameScreen.classList.remove("is-hidden");
    resizeCanvas();
    drawIdle();
  });
});

window.addEventListener("keydown", (event) => {
  const lane = keys.get(event.key.toLowerCase());
  if (lane === undefined || event.repeat) return;
  event.preventDefault();
  pressLane(lane);
});

window.addEventListener("keyup", (event) => {
  const lane = keys.get(event.key.toLowerCase());
  if (lane === undefined) return;
  laneButtons[lane].classList.remove("is-down");
});

laneButtons.forEach((button) => {
  const lane = Number(button.dataset.lane);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pressLane(lane);
  });
  button.addEventListener("pointerup", () => button.classList.remove("is-down"));
  button.addEventListener("pointercancel", () => button.classList.remove("is-down"));
  button.addEventListener("pointerleave", () => button.classList.remove("is-down"));
});

async function startGame() {
  try {
    startButton.disabled = true;
    resultLabel.textContent = "";
    startButton.querySelector("span").textContent = "START";
    startButton.querySelector("small").textContent = "Loading...";

    if (!state.audioContext) {
      state.audioContext = new AudioContext();
    }

    if (!state.buffer) {
      const response = await fetch(audioFile);
      const arrayBuffer = await response.arrayBuffer();
      state.buffer = await state.audioContext.decodeAudioData(arrayBuffer);
      const manualChart = await loadManualChart();
      if (manualChart) {
        state.notes = manualChart.notes;
        state.sections = manualChart.sections;
      } else {
        const chart = buildChart(state.buffer);
        state.notes = chart.notes;
        state.sections = chart.sections;
      }
    }

    stopAudio();
    resetScore();

    state.source = state.audioContext.createBufferSource();
    state.source.buffer = state.buffer;
    state.source.connect(state.audioContext.destination);
    state.source.onended = finishGame;

    state.running = true;
    state.finished = false;
    startButton.classList.add("is-hidden");
    clearInterval(state.loop);
    state.loop = setInterval(() => {
      try {
        tick();
      } catch (error) {
        console.error(error);
      }
    }, 1000 / 60);

    state.startTime = state.audioContext.currentTime + 0.08;
    state.startPerf = performance.now() + 80;
    state.source.start(state.startTime);
    state.audioContext.resume().catch((error) => {
      console.error(error);
    });
  } catch (error) {
    state.running = false;
    clearInterval(state.loop);
    startButton.disabled = false;
    startButton.classList.remove("is-hidden");
    startButton.querySelector("small").textContent = "音源を読み込めませんでした";
    updateHud("Error");
    console.error(error);
  }
}

function stopAudio() {
  clearInterval(state.loop);
  state.loop = null;
  if (!state.source) return;
  try {
    state.source.stop();
  } catch {
    // A stopped source cannot be stopped twice.
  }
  state.source.disconnect();
  state.source = null;
}

function resetScore() {
  state.score = 0;
  state.combo = 0;
  state.perfectClear = true;
  state.notes.forEach((note) => {
    note.hit = false;
    note.missed = false;
  });
  updateHud("Ready");
}

async function loadManualChart() {
  try {
    const response = await fetch(`./chart.json?cache=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const chart = await response.json();
    const rawNotes = Array.isArray(chart) ? chart : chart.notes;
    if (!Array.isArray(rawNotes) || rawNotes.length === 0) return null;

    const notes = rawNotes
      .map((note) => ({
        time: Number(note.time),
        lane: Number(note.lane),
        section: "manual",
        hit: false,
        missed: false,
      }))
      .filter((note) => Number.isFinite(note.time) && note.time >= 0 && note.lane >= 0 && note.lane <= 3)
      .sort((a, b) => a.time - b.time || a.lane - b.lane);

    if (!notes.length) return null;

    return {
      notes,
      sections: [
        {
          id: "manual",
          label: "Manual",
          start: 0,
          end: state.buffer.duration,
          peakMultiplier: 1,
          minGap: 0,
        },
      ],
    };
  } catch {
    return null;
  }
}

function buildChart(buffer) {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = 2048;
  const energies = [];

  for (let i = 0; i < data.length; i += windowSize) {
    let sum = 0;
    for (let j = i; j < i + windowSize && j < data.length; j++) {
      sum += Math.abs(data[j]);
    }
    energies.push(sum / windowSize);
  }

  const sections = analyzeSections(energies, windowSize, sampleRate, buffer.duration);
  const notes = [];
  let lastTime = -1;
  for (let i = 4; i < energies.length - 1; i++) {
    const localAverage =
      (energies[i - 4] + energies[i - 3] + energies[i - 2] + energies[i - 1]) / 4;
    const time = (i * windowSize) / sampleRate;
    const section = getSectionAt(time, sections);
    const isPeak =
      energies[i] > localAverage * section.peakMultiplier &&
      energies[i] > energies[i - 1] &&
      energies[i] >= energies[i + 1];
    if (!isPeak || time < 0.7 || time - lastTime < section.minGap) continue;
    notes.push({
      time,
      lane: Math.abs(Math.floor((energies[i] * 10000 + i) % 4)),
      section: section.id,
      hit: false,
      missed: false,
    });
    lastTime = time;
  }

  if (notes.length >= 24) return { notes, sections };

  const fallback = [];
  for (let time = 1; time < buffer.duration - 0.6; time += 0.5) {
    const section = getSectionAt(time, sections);
    fallback.push({ time, lane: Math.floor(time * 2) % 4, section: section.id, hit: false, missed: false });
  }
  return { notes: fallback, sections };
}

function analyzeSections(energies, windowSize, sampleRate, duration) {
  const secondsPerEnergy = windowSize / sampleRate;
  const phraseSeconds = 4;
  const phraseSize = Math.max(1, Math.round(phraseSeconds / secondsPerEnergy));
  const phrases = [];

  for (let i = 0; i < energies.length; i += phraseSize) {
    const slice = energies.slice(i, i + phraseSize);
    const average = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    phrases.push({
      start: i * secondsPerEnergy,
      end: Math.min(duration, (i + phraseSize) * secondsPerEnergy),
      energy: average,
    });
  }

  const smoothed = phrases.map((phrase, index) => {
    const neighbors = phrases.slice(Math.max(0, index - 1), Math.min(phrases.length, index + 2));
    const energy = neighbors.reduce((sum, value) => sum + value.energy, 0) / neighbors.length;
    return { ...phrase, energy };
  });

  const sorted = smoothed.map((phrase) => phrase.energy).sort((a, b) => a - b);
  const low = percentile(sorted, 0.42);
  const high = percentile(sorted, 0.72);
  const raw = smoothed.map((phrase) => ({
    start: phrase.start,
    end: phrase.end,
    ...sectionPreset(phrase.energy >= high ? "chorus" : phrase.energy >= low ? "bridge" : "verse"),
  }));

  const merged = [];
  for (const section of raw) {
    const previous = merged[merged.length - 1];
    if (previous && previous.id === section.id && section.start - previous.end <= phraseSeconds + 0.05) {
      previous.end = section.end;
      continue;
    }
    merged.push({ ...section });
  }

  const counts = { Aメロ: 0, Bメロ: 0, サビ: 0 };
  return merged.map((section) => {
    counts[section.baseLabel] += 1;
    return {
      ...section,
      label: `${section.baseLabel}${counts[section.baseLabel]}`,
    };
  });
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(sortedValues.length * ratio)));
  return sortedValues[index];
}

function sectionPreset(id) {
  if (id === "chorus") {
    return {
      id,
      baseLabel: "サビ",
      peakMultiplier: 1.23,
      minGap: 0.13,
    };
  }
  if (id === "bridge") {
    return {
      id,
      baseLabel: "Bメロ",
      peakMultiplier: 1.42,
      minGap: 0.18,
    };
  }
  return {
    id,
    baseLabel: "Aメロ",
    peakMultiplier: 1.65,
    minGap: 0.26,
  };
}

function getSectionAt(time, sections = state.sections) {
  return (
    sections.find((section) => time >= section.start && time < section.end) ||
    sections[sections.length - 1] ||
    sectionPreset("verse")
  );
}

function tick() {
  if (!state.running) return;

  const now = getSongTime();
  const noteTravelRate = 1.15;
  state.visualTime += state.running ? 1 : 0;
  progressEl.style.width = `${Math.min(100, (now / state.buffer.duration) * 100)}%`;

  drawGame(now, noteTravelRate);
  checkMisses(now);
}

function getSongTime() {
  if (!state.audioContext) return 0;
  if (state.audioContext.state !== "running") {
    return Math.max(0, (performance.now() - state.startPerf) / 1000);
  }
  return Math.max(0, state.audioContext.currentTime - state.startTime);
}

function pressLane(lane) {
  laneButtons[lane].classList.add("is-down");
  setTimeout(() => laneButtons[lane].classList.remove("is-down"), 110);
  if (!state.running) return;

  const now = getSongTime();
  let best = null;
  for (const note of state.notes) {
    if (note.hit || note.missed || note.lane !== lane) continue;
    const delta = Math.abs(note.time - now);
    if (delta > 0.18) continue;
    if (!best || delta < best.delta) best = { note, delta };
  }

  if (!best) {
    state.combo = 0;
    state.perfectClear = false;
    updateHud("Bad");
    return;
  }

  best.note.hit = true;
  state.combo += 1;

  const greatLeadSeconds = 0.04;
  const greatWindowSeconds = 0.135;
  const greatDelta = Math.abs(best.note.time - greatLeadSeconds - now);
  const judgement = best.delta < 0.055 ? "Perfect" : greatDelta < greatWindowSeconds ? "Great" : "Good";
  if (judgement !== "Perfect") {
    state.perfectClear = false;
  }
  const points = judgement === "Perfect" ? 1000 : judgement === "Great" ? 700 : 420;
  state.score += points + state.combo * 8;
  flashHit(judgement);
  flashComboMilestone();
  updateHud(judgement);
}

function checkMisses(now) {
  for (const note of state.notes) {
    if (note.hit || note.missed || now - note.time < 0.2) continue;
    note.missed = true;
    state.combo = 0;
    state.perfectClear = false;
    updateHud("Miss");
  }
}

function updateHud(judgement) {
  scoreEl.textContent = state.score.toLocaleString();
  comboEl.textContent = state.combo.toLocaleString();
}

function finishGame() {
  if (state.finished) return;
  state.running = false;
  state.finished = true;
  clearInterval(state.loop);
  state.loop = null;
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem("sakura-rhythm-best", String(state.best));
    bestEl.textContent = state.best.toLocaleString();
  }
  startButton.disabled = false;
  const allNotesHit = state.notes.length > 0 && state.notes.every((note) => note.hit);
  resultLabel.textContent = state.perfectClear && allNotesHit ? "PERFECT" : "クリアー";
  startButton.querySelector("span").textContent = "RETRY";
  startButton.querySelector("small").textContent = "";
  startButton.classList.remove("is-hidden");
  updateHud("Finish");
}

function flashHit(judgement) {
  hitFlash.classList.add("is-active");
  setTimeout(() => hitFlash.classList.remove("is-active"), 70);

  const popClass = judgement === "Perfect" ? "is-perfect" : judgement === "Great" ? "is-great" : "is-good";
  const popText = judgement === "Perfect" ? "NICE" : judgement.toUpperCase();

  judgementPop.textContent = popText;
  judgementPop.classList.remove("is-perfect", "is-great", "is-good");
  screenFlash.classList.remove("is-perfect", "is-great");

  void judgementPop.offsetWidth;
  void screenFlash.offsetWidth;

  judgementPop.classList.add(popClass);
  if (judgement === "Perfect") {
    screenFlash.classList.add("is-perfect");
  } else if (judgement === "Great") {
    screenFlash.classList.add("is-great");
  }
}

function flashComboMilestone() {
  if (state.combo === 0 || state.combo % 25 !== 0) return;
  comboPop.textContent = `${state.combo} COMBO!`;
  comboPop.classList.remove("is-active");
  void comboPop.offsetWidth;
  comboPop.classList.add("is-active");
}

function drawGame(now, noteTravelRate) {
  const width = canvas.width;
  const height = canvas.height;
  const leadTime = 1.65 / noteTravelRate;

  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);

  for (const note of state.notes) {
    if (note.hit || note.missed) continue;
    const untilHit = note.time - now;
    if (untilHit < -0.25 || untilHit > leadTime) continue;
    const progress = 1 - untilHit / leadTime;
    drawNote(note.lane, progress, width, height, laneColors[note.lane]);
  }
}

function drawBackground(width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#03040b");
  gradient.addColorStop(0.58, "#080b16");
  gradient.addColorStop(1, "#03050b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  drawSpaceField(width, height, state.visualTime);
  drawHorizonImage(width, height);
  drawSideImages(width, height);

  const horizon = depthPoint(0, width, height);
  const front = depthPoint(1, width, height);

  ctx.save();
  const laneGradient = ctx.createLinearGradient(0, horizon.y, 0, front.y);
  laneGradient.addColorStop(0, "rgba(45,226,255,0.03)");
  laneGradient.addColorStop(1, "rgba(255,62,165,0.1)");
  ctx.fillStyle = laneGradient;
  ctx.beginPath();
  ctx.moveTo(horizon.left, horizon.y);
  ctx.lineTo(horizon.right, horizon.y);
  ctx.lineTo(front.right, front.y);
  ctx.lineTo(front.left, front.y);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i <= 4; i++) {
    const far = laneBoundaryPoint(i, 0, width, height);
    const near = laneBoundaryPoint(i, 1, width, height);
    ctx.strokeStyle = i === 0 || i === 4 ? "rgba(45,226,255,0.72)" : "rgba(45,226,255,0.32)";
    ctx.lineWidth = i === 0 || i === 4 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(far.x, far.y);
    ctx.lineTo(near.x, near.y);
    ctx.stroke();
  }

  for (let i = 0; i < 12; i++) {
    const p = i / 11;
    const band = depthPoint(p, width, height);
    ctx.strokeStyle = i === 11 ? "#ffe66d" : `rgba(255,62,165,${0.12 + p * 0.28})`;
    ctx.lineWidth = i === 11 ? 4 : 1;
    ctx.beginPath();
    ctx.moveTo(band.left, band.y);
    ctx.lineTo(band.right, band.y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.moveTo(front.left, front.y - 7);
  ctx.lineTo(front.right, front.y - 7);
  ctx.lineTo(front.right, front.y + 7);
  ctx.lineTo(front.left, front.y + 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSideImages(width, height) {
  if (!sideImage.complete || sideImage.naturalWidth === 0) return;

  const imageSize = Math.min(width * 0.3696, height * 0.4224);
  const x = imageSize * 0.02;
  const y = height * 0.26;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.68;
  ctx.drawImage(sideImage, x, y, imageSize, imageSize);
  ctx.restore();

  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.68;
  ctx.drawImage(sideImage, x, y, imageSize, imageSize);
  ctx.restore();
}

function drawHorizonImage(width, height) {
  if (!horizonImage.complete || horizonImage.naturalWidth === 0) return;

  const centerX = width / 2;
  const imageSize = Math.min(width * 0.756, height * 0.4515);
  const x = centerX - imageSize / 2;
  const y = -imageSize * 0.1;
  const cropTop = horizonImage.naturalHeight * 0.1;
  const cropHeight = horizonImage.naturalHeight - cropTop;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.9;
  ctx.drawImage(horizonImage, 0, cropTop, horizonImage.naturalWidth, cropHeight, x, y, imageSize, imageSize);
  ctx.restore();
}

function drawSpaceField(width, height, visualTime) {
  const originX = width / 2;
  const originY = height * 0.16;
  const maxRadius = Math.hypot(width, height) * 0.72;
  const comboPower = Math.min(1, state.combo / 100);
  const activeStars = Math.round(34 + comboPower * (spaceStars.length - 34));
  const colorSteps = comboPower >= 0.75 ? 4 : comboPower >= 0.5 ? 3 : comboPower >= 0.25 ? 2 : 1;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const nebula = ctx.createRadialGradient(originX, originY, 0, originX, originY, maxRadius * 0.72);
  nebula.addColorStop(0, "rgba(45,226,255,0.1)");
  nebula.addColorStop(0.42, "rgba(255,62,165,0.055)");
  nebula.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < activeStars; i++) {
    const star = spaceStars[i];
    const depth = (star.depth + visualTime * star.speed) % 1;
    const eased = depth * depth;
    const radius = star.radius * maxRadius * eased;
    const x = originX + Math.cos(star.angle) * radius;
    const y = originY + Math.sin(star.angle) * radius * 0.62 + eased * height * 0.55;
    const frontFade = Math.max(0, 1 - Math.max(0, depth - 0.82) / 0.18);
    const backFade = Math.min(1, depth / 0.18);
    const alpha = (0.18 + depth * 0.68) * frontFade * backFade;
    if (x < -20 || x > width + 20 || y < -20 || y > height + 20 || alpha <= 0) continue;

    ctx.fillStyle = colorSteps === 1 ? "#ffffff" : starColorForCombo(star.color, colorSteps);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, star.size + depth * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function starColorForCombo(color, colorSteps) {
  if (colorSteps >= 4) return color;
  if (colorSteps === 3 && color !== "#ff3ea5") return color;
  if (colorSteps === 2 && (color === "#ffffff" || color === "#2de2ff")) return color;
  return "#ffffff";
}

function drawNote(lane, progress, width, height, color) {
  const frontProgress = Math.min(1, progress + 0.045);
  const backProgress = Math.max(0, progress - 0.015);
  const leftBack = laneBoundaryPoint(lane, backProgress, width, height);
  const rightBack = laneBoundaryPoint(lane + 1, backProgress, width, height);
  const leftFront = laneBoundaryPoint(lane, frontProgress, width, height);
  const rightFront = laneBoundaryPoint(lane + 1, frontProgress, width, height);
  const insetBack = (rightBack.x - leftBack.x) * 0.17;
  const insetFront = (rightFront.x - leftFront.x) * 0.12;

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 14 + progress * 22;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(leftBack.x + insetBack, leftBack.y);
  ctx.lineTo(rightBack.x - insetBack, rightBack.y);
  ctx.lineTo(rightFront.x - insetFront, rightFront.y);
  ctx.lineTo(leftFront.x + insetFront, leftFront.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = Math.max(1, 1 + progress * 2);
  ctx.stroke();
  ctx.restore();
}

function drawIdle() {
  drawBackground(canvas.width, canvas.height);
}

function depthPoint(progress, width, height) {
  const eased = progress * progress;
  const y = height * 0.34 + eased * height * 0.54;
  const laneWidth = width * (0.14 + eased * 0.82);
  const center = width / 2;
  return {
    y,
    left: center - laneWidth / 2,
    right: center + laneWidth / 2,
  };
}

function laneBoundaryPoint(index, progress, width, height) {
  const depth = depthPoint(progress, width, height);
  return {
    x: depth.left + (depth.right - depth.left) * (index / 4),
    y: depth.y,
  };
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width));
  canvas.height = Math.max(1, Math.floor(rect.height));
}
