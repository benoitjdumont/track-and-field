/**
 * Studio-grade instrumental loop generator using OfflineAudioContext.
 * - Zero vocals
 * - Zero harsh 8-bit/square video-game sounds
 * - 10 distinct upbeat, motivating tracks for walks, hikes, and runs
 * - Mathematically seamless circular loop wrapping (reverb/delay/release tails wrap back to bar 1)
 */

export interface MusicTrackMeta {
  id: string;
  title: string;
  genre: string;
  mood: string;
  bpm: number;
  keyLabel: string;
  bars: number;
  accentColor: string;
}

export const MUSIC_TRACKS: MusicTrackMeta[] = [
  {
    id: 'horizon-dore',
    title: 'Horizon Doré',
    genre: 'Indie Pop Acoustique',
    mood: 'Ensoleillé & Entraînant',
    bpm: 116,
    keyLabel: 'Sol Majeur',
    bars: 8,
    accentColor: '#FF5A1F',
  },
  {
    id: 'sommet-alpin',
    title: 'Sommet Alpin',
    genre: 'Folk Énergique',
    mood: 'Dynamique & Grand Air',
    bpm: 122,
    keyLabel: 'Ré Majeur',
    bars: 8,
    accentColor: '#10B981',
  },
  {
    id: 'brise-cotiere',
    title: 'Brise Côtière',
    genre: 'Groove Baléare & Rhodes',
    mood: 'Fluide & Chaleureux',
    bpm: 108,
    keyLabel: 'Fa Majeur',
    bars: 8,
    accentColor: '#0EA5E9',
  },
  {
    id: 'sentier-emeraude',
    title: 'Sentier Émeraude',
    genre: 'Organic House Mélodique',
    mood: 'Hypnotique & Moderne',
    bpm: 118,
    keyLabel: 'La Mineur',
    bars: 8,
    accentColor: '#14B8A6',
  },
  {
    id: 'aurore-boreale',
    title: 'Aurore Boréale',
    genre: 'Piano & Cordes Cinématiques',
    mood: 'Épique & Inspirant',
    bpm: 102,
    keyLabel: 'Do Majeur',
    bars: 8,
    accentColor: '#8B5CF6',
  },
  {
    id: 'rythme-urbain',
    title: 'Rythme Urbain',
    genre: 'Nu-Disco Funky',
    mood: 'Groovy & Pêchu',
    bpm: 124,
    keyLabel: 'Mi Mineur',
    bars: 8,
    accentColor: '#F59E0B',
  },
  {
    id: 'vallee-sauvage',
    title: 'Vallée Sauvage',
    genre: 'Aventure Acoustique',
    mood: 'Rythmé & Héroïque',
    bpm: 114,
    keyLabel: 'Mi Majeur',
    bars: 8,
    accentColor: '#EF4444',
  },
  {
    id: 'coucher-soleil',
    title: 'Coucher de Soleil',
    genre: 'Soul & Chill Groove',
    mood: 'Détendu & Velouté',
    bpm: 94,
    keyLabel: 'Ré Mineur',
    bars: 8,
    accentColor: '#EC4899',
  },
  {
    id: 'elan-matinal',
    title: 'Élan Matinal',
    genre: 'Électro Chaleureux',
    mood: 'Cardio & Lumineux',
    bpm: 126,
    keyLabel: 'La Majeur',
    bars: 8,
    accentColor: '#3B82F6',
  },
  {
    id: 'odyssee-nordique',
    title: 'Odyssée Nordique',
    genre: 'Handpan & Percussions',
    mood: 'Organique & Tribal',
    bpm: 104,
    keyLabel: 'Si Mineur',
    bars: 8,
    accentColor: '#84CC16',
  },
];

// Deterministic PRNG for warm organic percussion & Karplus-Strong excitation
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Create warm stereo impulse response for natural acoustic room reverb
function createWarmReverbIR(ctx: BaseAudioContext, durationSec = 1.9, decay = 2.6, seed = 42): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const ir = ctx.createBuffer(2, length, rate);
  const rand = mulberry32(seed);

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      const white = rand() * 2 - 1;
      // Warm 1-pole lowpass to remove metallic hiss
      lp = lp * 0.78 + white * 0.22;
      data[i] = lp * env;
    }
  }
  return ir;
}

// Shared filtered noise buffer for organic acoustic percussion (brushes, shakers, claps)
function createPinkNoiseBuffer(ctx: BaseAudioContext, seconds = 1.0, seed = 101): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rand = mulberry32(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
  for (let i = 0; i < length; i++) {
    const white = rand() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    b3 = b3; // keep lint clean
  }
  return buf;
}

// Karplus-Strong physical-modeled acoustic guitar / nylon pluck buffer
function createPluckedStringBuffer(
  ctx: BaseAudioContext,
  freq: number,
  durationSec: number,
  brightness = 0.55,
  seed = 7
): AudioBuffer {
  const sr = ctx.sampleRate;
  const totalSamples = Math.floor(sr * durationSec);
  const period = Math.max(2, Math.round(sr / freq));
  const buf = ctx.createBuffer(1, totalSamples, sr);
  const out = buf.getChannelData(0);
  const rand = mulberry32(seed + Math.round(freq * 10));

  // Soft low-passed burst excitation (sounds like fingers/pick on nylon/steel strings)
  const delayLine = new Float32Array(period);
  let prev = 0;
  for (let i = 0; i < period; i++) {
    const raw = rand() * 2 - 1;
    prev = prev * 0.45 + raw * 0.55;
    delayLine[i] = prev;
  }

  let idx = 0;
  let dampState = 0;
  const damp = 0.9945 - (1 - brightness) * 0.004;
  const alpha = 0.35 + brightness * 0.45;

  for (let i = 0; i < totalSamples; i++) {
    const nextIdx = (idx + 1) % period;
    const avg = 0.5 * (delayLine[idx] + delayLine[nextIdx]);
    dampState = dampState * (1 - alpha) + avg * alpha;
    delayLine[idx] = dampState * damp;
    out[i] = delayLine[idx];
    idx = nextIdx;
  }

  // Smooth tail fade-out to avoid click
  const fadeSamples = Math.min(totalSamples, Math.floor(sr * 0.04));
  for (let i = 0; i < fadeSamples; i++) {
    out[totalSamples - 1 - i] *= i / fadeSamples;
  }
  return buf;
}

interface VoiceTargets {
  dry: AudioNode;
  wet: AudioNode;
}

function triggerAcousticPluck(
  ctx: BaseAudioContext,
  targets: VoiceTargets,
  time: number,
  midi: number,
  dur: number,
  gainVal: number,
  pan = 0,
  brightness = 0.6,
  reverbSend = 0.25
) {
  const buf = createPluckedStringBuffer(ctx, midiToFreq(midi), Math.min(2.6, dur + 0.4), brightness, midi);
  const src = ctx.createBufferSource();
  src.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3400, time);
  filter.frequency.exponentialRampToValueAtTime(1100, time + Math.min(1.2, dur));

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gainVal, time + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, time);

  const wetG = ctx.createGain();
  wetG.gain.value = reverbSend;

  src.connect(filter);
  filter.connect(g);
  g.connect(panner);
  panner.connect(targets.dry);
  panner.connect(wetG);
  wetG.connect(targets.wet);

  src.start(time);
  src.stop(time + dur + 0.05);
}

// Warm Rhodes / Felt Piano voice (multi-harmonic sine + triangle + gentle hammer bell)
function triggerWarmKeys(
  ctx: BaseAudioContext,
  targets: VoiceTargets,
  time: number,
  midi: number,
  dur: number,
  gainVal: number,
  mode: 'rhodes' | 'piano' | 'organ' | 'brass',
  pan = 0,
  reverbSend = 0.3
) {
  const freq = midiToFreq(midi);
  const p = ctx.createStereoPanner();
  p.pan.setValueAtTime(pan, time);

  const masterG = ctx.createGain();
  masterG.gain.setValueAtTime(0.0001, time);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';

  if (mode === 'rhodes') {
    masterG.gain.linearRampToValueAtTime(gainVal, time + 0.012);
    masterG.gain.exponentialRampToValueAtTime(gainVal * 0.35, time + dur * 0.6);
    masterG.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    filter.frequency.setValueAtTime(2600, time);
    filter.frequency.exponentialRampToValueAtTime(850, time + dur);

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, time);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(freq * 2, time);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.22, time);
    g2.gain.exponentialRampToValueAtTime(0.02, time + 0.35);

    o1.connect(filter);
    o2.connect(g2);
    g2.connect(filter);
    o1.start(time);
    o2.start(time);
    o1.stop(time + dur + 0.04);
    o2.stop(time + dur + 0.04);
  } else if (mode === 'piano') {
    masterG.gain.linearRampToValueAtTime(gainVal, time + 0.006);
    masterG.gain.exponentialRampToValueAtTime(gainVal * 0.25, time + dur * 0.7);
    masterG.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    filter.frequency.setValueAtTime(3200, time);
    filter.frequency.exponentialRampToValueAtTime(750, time + dur);

    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(freq, time);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * 2, time);
    const o3 = ctx.createOscillator();
    o3.type = 'sine';
    o3.frequency.setValueAtTime(freq * 3, time);

    const g2 = ctx.createGain();
    g2.gain.value = 0.28;
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.12, time);
    g3.gain.exponentialRampToValueAtTime(0.005, time + 0.22);

    o1.connect(filter);
    o2.connect(g2);
    g2.connect(filter);
    o3.connect(g3);
    g3.connect(filter);
    o1.start(time);
    o2.start(time);
    o3.start(time);
    o1.stop(time + dur + 0.04);
    o2.stop(time + dur + 0.04);
    o3.stop(time + dur + 0.04);
  } else if (mode === 'brass') {
    masterG.gain.linearRampToValueAtTime(gainVal, time + 0.04);
    masterG.gain.setValueAtTime(gainVal * 0.8, time + dur * 0.75);
    masterG.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    filter.frequency.setValueAtTime(600, time);
    filter.frequency.linearRampToValueAtTime(2100, time + 0.09);
    filter.frequency.exponentialRampToValueAtTime(950, time + dur);

    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, time);
      o.detune.setValueAtTime(detune, time);
      const og = ctx.createGain();
      og.gain.value = 0.35;
      o.connect(og);
      og.connect(filter);
      o.start(time);
      o.stop(time + dur + 0.04);
    }
  } else {
    // warm organ / pad chord
    masterG.gain.linearRampToValueAtTime(gainVal, time + Math.min(0.28, dur * 0.3));
    masterG.gain.setValueAtTime(gainVal * 0.85, time + dur * 0.75);
    masterG.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    filter.frequency.setValueAtTime(1400, time);

    for (const detune of [-8, 0, 8]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, time);
      o.detune.setValueAtTime(detune, time);
      const og = ctx.createGain();
      og.gain.value = 0.33;
      o.connect(og);
      og.connect(filter);
      o.start(time);
      o.stop(time + dur + 0.06);
    }
  }

  filter.connect(masterG);
  masterG.connect(p);
  const wetG = ctx.createGain();
  wetG.gain.value = reverbSend;
  p.connect(targets.dry);
  p.connect(wetG);
  wetG.connect(targets.wet);
}

// Marimba / Kalimba / Handpan resonant melodic percussion
function triggerTunedPerc(
  ctx: BaseAudioContext,
  targets: VoiceTargets,
  time: number,
  midi: number,
  gainVal: number,
  style: 'marimba' | 'kalimba' | 'handpan',
  pan = 0
) {
  const freq = midiToFreq(midi);
  const dur = style === 'handpan' ? 1.15 : style === 'marimba' ? 0.55 : 0.48;
  const o1 = ctx.createOscillator();
  o1.type = 'sine';
  o1.frequency.setValueAtTime(freq, time);

  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(style === 'marimba' ? freq * 4 : freq * 2, time);

  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(0.0001, time);
  g1.gain.linearRampToValueAtTime(gainVal, time + 0.005);
  g1.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, time);
  g2.gain.linearRampToValueAtTime(gainVal * (style === 'handpan' ? 0.32 : 0.18), time + 0.003);
  g2.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

  const p = ctx.createStereoPanner();
  p.pan.setValueAtTime(pan, time);

  const wetG = ctx.createGain();
  wetG.gain.value = style === 'handpan' ? 0.42 : 0.28;

  o1.connect(g1);
  o2.connect(g2);
  g1.connect(p);
  g2.connect(p);
  p.connect(targets.dry);
  p.connect(wetG);
  wetG.connect(targets.wet);

  o1.start(time);
  o2.start(time);
  o1.stop(time + dur + 0.05);
  o2.stop(time + 0.16);
}

// Warm rounded upright / sub bass
function triggerWarmBass(
  ctx: BaseAudioContext,
  targets: VoiceTargets,
  time: number,
  midi: number,
  dur: number,
  gainVal: number,
  punch = false
) {
  const freq = midiToFreq(midi);
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(freq, time);

  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(freq, time);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(punch ? 780 : 420, time);
  filter.frequency.exponentialRampToValueAtTime(220, time + Math.min(dur, 0.35));

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gainVal, time + 0.015);
  g.gain.setValueAtTime(gainVal * 0.85, time + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  const bodyG = ctx.createGain();
  bodyG.gain.value = punch ? 0.55 : 0.32;

  sub.connect(g);
  body.connect(bodyG);
  bodyG.connect(filter);
  filter.connect(g);
  g.connect(targets.dry);

  sub.start(time);
  body.start(time);
  sub.stop(time + dur + 0.04);
  body.stop(time + dur + 0.04);
}

// Organic drums
function triggerKick(ctx: BaseAudioContext, targets: VoiceTargets, time: number, gainVal = 0.65, deep = false) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(deep ? 120 : 145, time);
  o.frequency.exponentialRampToValueAtTime(deep ? 42 : 48, time + 0.075);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gainVal, time + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, time + (deep ? 0.32 : 0.24));

  o.connect(g);
  g.connect(targets.dry);
  o.start(time);
  o.stop(time + 0.35);
}

function triggerOrganicSnare(
  ctx: BaseAudioContext,
  targets: VoiceTargets,
  noiseBuf: AudioBuffer,
  time: number,
  gainVal: number,
  style: 'brush' | 'rim' | 'clap' | 'conga'
) {
  if (style === 'rim' || style === 'conga') {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const startF = style === 'conga' ? 320 : 780;
    const endF = style === 'conga' ? 195 : 420;
    o.frequency.setValueAtTime(startF, time);
    o.frequency.exponentialRampToValueAtTime(endF, time + 0.045);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gainVal, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, time + (style === 'conga' ? 0.14 : 0.07));

    const wetG = ctx.createGain();
    wetG.gain.value = 0.22;
    o.connect(g);
    g.connect(targets.dry);
    g.connect(wetG);
    wetG.connect(targets.wet);
    o.start(time);
    o.stop(time + 0.18);
    return;
  }

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(style === 'clap' ? 1850 : 2600, time);
  bp.Q.value = style === 'clap' ? 1.1 : 0.8;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gainVal, time + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, time + (style === 'clap' ? 0.15 : 0.12));

  // Warm body
  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(190, time);
  body.frequency.exponentialRampToValueAtTime(115, time + 0.06);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(gainVal * 0.45, time);
  bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);

  const wetG = ctx.createGain();
  wetG.gain.value = 0.25;

  src.connect(bp);
  bp.connect(g);
  body.connect(bg);
  g.connect(targets.dry);
  bg.connect(targets.dry);
  g.connect(wetG);
  wetG.connect(targets.wet);

  src.start(time);
  body.start(time);
  src.stop(time + 0.2);
  body.stop(time + 0.1);
}

function triggerShaker(
  ctx: BaseAudioContext,
  targets: VoiceTargets,
  noiseBuf: AudioBuffer,
  time: number,
  gainVal: number,
  open = false
) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(open ? 5600 : 7200, time);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gainVal, time + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, time + (open ? 0.11 : 0.045));

  src.connect(hp);
  hp.connect(g);
  g.connect(targets.dry);
  src.start(time);
  src.stop(time + 0.14);
}

function renderTrackEvents(
  ctx: OfflineAudioContext,
  targets: VoiceTargets,
  noiseBuf: AudioBuffer,
  trackId: string,
  bpm: number,
  bars: number
) {
  const beat = 60 / bpm;
  const sixteenth = beat / 4;
  const totalSteps = bars * 16;

  // Chord progressions per 2 bars (4 chords over 8 bars)
  type ChordDef = number[];
  const progressions: Record<string, { chords: ChordDef[]; bass: number[]; lead: number[] }> = {
    'horizon-dore': {
      // G - D - Em - C (uplifting outdoor pop)
      chords: [
        [55, 59, 62, 67],
        [50, 57, 62, 66],
        [52, 59, 64, 67],
        [48, 55, 60, 64],
      ],
      bass: [43, 38, 40, 36],
      lead: [74, 76, 79, 74, 78, 74, 79, 81, 79, 76, 74, 71, 72, 74, 76, 79],
    },
    'sommet-alpin': {
      // D - A - Bm - G (driving indie folk)
      chords: [
        [50, 57, 62, 66],
        [57, 61, 64, 69],
        [59, 62, 66, 71],
        [55, 59, 62, 67],
      ],
      bass: [38, 45, 47, 43],
      lead: [74, 78, 81, 78, 76, 73, 76, 81, 78, 74, 71, 74, 79, 78, 74, 73],
    },
    'brise-cotiere': {
      // Fmaj7 - G6 - Em7 - Am7 (Balearic sunny)
      chords: [
        [53, 57, 60, 64],
        [55, 59, 62, 64],
        [52, 55, 59, 62],
        [57, 60, 64, 67],
      ],
      bass: [41, 43, 40, 45],
      lead: [72, 76, 79, 76, 74, 79, 81, 79, 76, 74, 72, 71, 72, 76, 79, 84],
    },
    'sentier-emeraude': {
      // Am9 - Fmaj7 - Cmaj7 - G6 (organic house)
      chords: [
        [57, 60, 64, 71],
        [53, 57, 60, 64],
        [48, 55, 60, 64],
        [55, 59, 62, 64],
      ],
      bass: [45, 41, 36, 43],
      lead: [69, 72, 76, 79, 76, 72, 76, 81, 79, 76, 72, 74, 71, 74, 76, 79],
    },
    'aurore-boreale': {
      // C - G/B - Am - F (cinematic piano & strings)
      chords: [
        [48, 55, 60, 64],
        [47, 55, 59, 62],
        [45, 52, 60, 64],
        [41, 53, 57, 60],
      ],
      bass: [36, 35, 33, 41],
      lead: [72, 76, 79, 76, 74, 79, 83, 79, 76, 81, 84, 81, 77, 81, 84, 79],
    },
    'rythme-urbain': {
      // Em7 - A7 - Cmaj7 - B7 (nu-disco funky)
      chords: [
        [52, 59, 62, 67],
        [57, 61, 64, 67],
        [48, 55, 59, 64],
        [47, 54, 57, 63],
      ],
      bass: [40, 45, 36, 35],
      lead: [76, 79, 83, 79, 81, 79, 76, 73, 76, 79, 83, 84, 83, 78, 75, 71],
    },
    'vallee-sauvage': {
      // E - B - C#m - A (adventure acoustic)
      chords: [
        [52, 59, 64, 68],
        [47, 54, 59, 63],
        [49, 56, 61, 64],
        [45, 52, 57, 61],
      ],
      bass: [40, 35, 37, 45],
      lead: [76, 80, 83, 80, 78, 75, 78, 83, 80, 76, 73, 76, 81, 80, 76, 75],
    },
    'coucher-soleil': {
      // Dm9 - G13 - Cmaj9 - A7 (warm soul chill)
      chords: [
        [50, 57, 60, 64],
        [55, 59, 62, 64],
        [48, 55, 59, 62],
        [45, 55, 61, 64],
      ],
      bass: [38, 43, 36, 45],
      lead: [69, 72, 74, 77, 74, 72, 71, 74, 72, 76, 79, 76, 73, 76, 79, 81],
    },
    'elan-matinal': {
      // A - E - F#m - D (energetic melodic)
      chords: [
        [57, 61, 64, 69],
        [52, 59, 64, 68],
        [54, 57, 61, 66],
        [50, 57, 62, 66],
      ],
      bass: [45, 40, 42, 38],
      lead: [69, 73, 76, 81, 80, 76, 73, 76, 78, 81, 85, 81, 78, 74, 78, 81],
    },
    'odyssee-nordique': {
      // Bm - G - D - A (world handpan)
      chords: [
        [47, 54, 59, 62],
        [43, 55, 59, 62],
        [50, 57, 62, 66],
        [45, 52, 57, 61],
      ],
      bass: [35, 43, 38, 45],
      lead: [71, 74, 78, 81, 78, 74, 79, 78, 74, 78, 81, 83, 81, 76, 73, 74],
    },
  };

  const prog = progressions[trackId] ?? progressions['horizon-dore'];

  for (let step = 0; step < totalSteps; step++) {
    const bar = Math.floor(step / 16);
    const barStep = step % 16;
    const chordIdx = Math.floor(bar / 2) % prog.chords.length;
    const chord = prog.chords[chordIdx];
    const bassRoot = prog.bass[chordIdx];

    // Subtle swing on odd 16th steps for chill/balearic/funk tracks
    const hasSwing = trackId === 'coucher-soleil' || trackId === 'brise-cotiere' || trackId === 'rythme-urbain';
    const swingOffset = hasSwing && barStep % 2 === 1 ? sixteenth * 0.14 : 0;
    const t = step * sixteenth + swingOffset;

    // 1. Drums & Percussion per genre
    if (trackId === 'horizon-dore' || trackId === 'elan-matinal' || trackId === 'sentier-emeraude') {
      // Four-on-the-floor motivating walk/jog pulse
      if (barStep % 4 === 0) {
        triggerKick(ctx, targets, t, 0.56, trackId === 'sentier-emeraude');
      }
      if (barStep === 4 || barStep === 12) {
        triggerOrganicSnare(
          ctx,
          targets,
          noiseBuf,
          t,
          0.26,
          trackId === 'elan-matinal' ? 'clap' : 'brush'
        );
      }
      if (barStep % 2 === 1) {
        triggerShaker(ctx, targets, noiseBuf, t, 0.085, barStep % 4 === 2);
      } else if (barStep % 4 === 2) {
        triggerShaker(ctx, targets, noiseBuf, t, 0.12, true);
      }
    } else if (trackId === 'sommet-alpin' || trackId === 'vallee-sauvage') {
      // Energetic folk/adventure beat
      if (barStep === 0 || barStep === 6 || barStep === 8 || barStep === 14) {
        triggerKick(ctx, targets, t, 0.58, false);
      }
      if (barStep === 4 || barStep === 12) {
        triggerOrganicSnare(ctx, targets, noiseBuf, t, 0.28, 'brush');
      }
      if (barStep % 2 === 0) {
        triggerShaker(ctx, targets, noiseBuf, t, barStep % 4 === 2 ? 0.11 : 0.06, false);
      }
    } else if (trackId === 'brise-cotiere' || trackId === 'odyssee-nordique') {
      // Organic world/bongo/conga groove
      if (barStep === 0 || barStep === 6 || barStep === 10) {
        triggerKick(ctx, targets, t, 0.54, true);
      }
      if (barStep === 3 || barStep === 7 || barStep === 12 || barStep === 15) {
        triggerOrganicSnare(ctx, targets, noiseBuf, t, 0.22, 'conga');
      }
      if (barStep === 4 || barStep === 12) {
        triggerOrganicSnare(ctx, targets, noiseBuf, t, 0.18, 'rim');
      }
      if (barStep % 2 === 1) {
        triggerShaker(ctx, targets, noiseBuf, t, 0.075, false);
      }
    } else if (trackId === 'rythme-urbain') {
      // Nu-disco four-on-the-floor + syncopated clap + disco hat
      if (barStep % 4 === 0) triggerKick(ctx, targets, t, 0.58, false);
      if (barStep === 4 || barStep === 12) triggerOrganicSnare(ctx, targets, noiseBuf, t, 0.3, 'clap');
      if (barStep % 4 === 2) triggerShaker(ctx, targets, noiseBuf, t, 0.14, true);
      else triggerShaker(ctx, targets, noiseBuf, t, 0.055, false);
    } else if (trackId === 'coucher-soleil') {
      // Laid-back chill groove
      if (barStep === 0 || barStep === 7 || barStep === 10) triggerKick(ctx, targets, t, 0.52, true);
      if (barStep === 4 || barStep === 12) triggerOrganicSnare(ctx, targets, noiseBuf, t, 0.2, 'rim');
      if (barStep % 2 === 0) triggerShaker(ctx, targets, noiseBuf, t, 0.06, false);
    } else {
      // aurore-boreale: gentle cinematic pulse
      if (barStep === 0 || barStep === 8) triggerKick(ctx, targets, t, 0.48, true);
      if (barStep === 12) triggerOrganicSnare(ctx, targets, noiseBuf, t, 0.14, 'brush');
      if (barStep % 4 === 2) triggerShaker(ctx, targets, noiseBuf, t, 0.045, false);
    }

    // 2. Bassline
    if (trackId === 'rythme-urbain') {
      // Octave disco funk bass
      if (barStep % 2 === 0) {
        const oct = barStep % 4 === 2 ? 12 : 0;
        triggerWarmBass(ctx, targets, t, bassRoot + oct, sixteenth * 1.6, 0.42, true);
      }
    } else if (trackId === 'sentier-emeraude' || trackId === 'elan-matinal') {
      if (barStep === 0 || barStep === 3 || barStep === 6 || barStep === 8 || barStep === 11 || barStep === 14) {
        triggerWarmBass(ctx, targets, t, bassRoot + (barStep === 14 ? 12 : 0), sixteenth * 2.2, 0.44, true);
      }
    } else if (barStep === 0 || barStep === 6 || barStep === 8) {
      triggerWarmBass(ctx, targets, t, bassRoot, beat * (barStep === 0 ? 1.4 : 0.9), 0.4, false);
    }

    // 3. Harmony & Acoustic Strums / Keys
    if (trackId === 'horizon-dore' || trackId === 'sommet-alpin' || trackId === 'vallee-sauvage') {
      // Guitar strumming pattern
      if (barStep === 0 || barStep === 3 || barStep === 6 || barStep === 8 || barStep === 11 || barStep === 14) {
        chord.forEach((n, idx) => {
          triggerAcousticPluck(
            ctx,
            targets,
            t + idx * 0.012,
            n + 12,
            beat * 1.3,
            0.14,
            (idx - 1.5) * 0.2,
            0.68,
            0.22
          );
        });
      }
      if (barStep === 0) {
        // Warm backing pad on bar start
        chord.forEach((n) => {
          triggerWarmKeys(ctx, targets, t, n, beat * 3.8, 0.06, 'organ', 0, 0.35);
        });
      }
    } else if (trackId === 'brise-cotiere' || trackId === 'coucher-soleil') {
      if (barStep === 0 || barStep === 6 || barStep === 10) {
        chord.forEach((n, idx) => {
          triggerWarmKeys(
            ctx,
            targets,
            t + idx * 0.015,
            n + 12,
            beat * 1.4,
            0.11,
            'rhodes',
            (idx - 1.5) * 0.18,
            0.35
          );
        });
      }
    } else if (trackId === 'aurore-boreale') {
      // Flowing cinematic piano arpeggios + warm string pad
      if (barStep % 2 === 0) {
        const note = chord[(barStep / 2) % chord.length] + 12;
        triggerWarmKeys(ctx, targets, t, note, beat * 1.6, 0.15, 'piano', -0.15, 0.42);
      }
      if (barStep === 0) {
        chord.forEach((n) => {
          triggerWarmKeys(ctx, targets, t, n, beat * 3.9, 0.065, 'organ', 0.1, 0.48);
        });
      }
    } else if (trackId === 'rythme-urbain') {
      if (barStep === 2 || barStep === 6 || barStep === 10 || barStep === 14) {
        chord.forEach((n, idx) => {
          triggerWarmKeys(ctx, targets, t, n + 12, sixteenth * 2.1, 0.075, 'brass', (idx - 1.5) * 0.2, 0.24);
        });
      }
    } else {
      // Organic house / synth / handpan pads
      if (barStep === 0) {
        chord.forEach((n) => {
          triggerWarmKeys(
            ctx,
            targets,
            t,
            n,
            beat * 3.8,
            0.07,
            trackId === 'elan-matinal' ? 'brass' : 'organ',
            0,
            0.4
          );
        });
      }
    }

    // 4. Uplifting Melodic Hook
    const leadNote = prog.lead[(bar * 2 + Math.floor(barStep / 2)) % prog.lead.length];
    if (trackId === 'horizon-dore' && (barStep === 0 || barStep === 3 || barStep === 6 || barStep === 10 || barStep === 12)) {
      triggerTunedPerc(ctx, targets, t, leadNote, 0.22, 'marimba', 0.18);
    } else if (trackId === 'sommet-alpin' && barStep % 2 === 0) {
      triggerAcousticPluck(ctx, targets, t, leadNote, beat * 0.9, 0.18, 0.15, 0.78, 0.3);
    } else if (trackId === 'brise-cotiere' && (barStep === 0 || barStep === 4 || barStep === 7 || barStep === 10 || barStep === 14)) {
      triggerTunedPerc(ctx, targets, t, leadNote, 0.2, 'kalimba', -0.2);
    } else if (trackId === 'sentier-emeraude' && (barStep % 3 === 0 || barStep === 14)) {
      triggerTunedPerc(ctx, targets, t, leadNote, 0.18, 'marimba', Math.sin(step) * 0.3);
    } else if (trackId === 'aurore-boreale' && (barStep === 0 || barStep === 6 || barStep === 12)) {
      triggerWarmKeys(ctx, targets, t, leadNote, beat * 1.8, 0.16, 'piano', 0.15, 0.45);
    } else if (trackId === 'rythme-urbain' && (barStep === 0 || barStep === 3 || barStep === 8 || barStep === 11)) {
      triggerWarmKeys(ctx, targets, t, leadNote, sixteenth * 2.5, 0.14, 'rhodes', 0.2, 0.25);
    } else if (trackId === 'vallee-sauvage' && (barStep === 0 || barStep === 4 || barStep === 8 || barStep === 10 || barStep === 14)) {
      triggerTunedPerc(ctx, targets, t, leadNote, 0.21, 'marimba', -0.15);
    } else if (trackId === 'coucher-soleil' && (barStep === 2 || barStep === 8 || barStep === 13)) {
      triggerAcousticPluck(ctx, targets, t, leadNote, beat * 1.4, 0.17, 0.22, 0.5, 0.35);
    } else if (trackId === 'elan-matinal' && barStep % 2 === 0) {
      triggerWarmKeys(ctx, targets, t, leadNote, sixteenth * 2.4, 0.11, 'rhodes', Math.cos(step * 0.5) * 0.25, 0.3);
    } else if (trackId === 'odyssee-nordique' && (barStep === 0 || barStep === 3 || barStep === 6 || barStep === 8 || barStep === 11 || barStep === 14)) {
      triggerTunedPerc(ctx, targets, t, leadNote, 0.23, 'handpan', Math.sin(step * 0.7) * 0.25);
    }
  }
}

class MusicEngine {
  private ctx: AudioContext | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private activeSource: AudioBufferSourceNode | null = null;
  private activeGain: GainNode | null = null;
  private currentTrackId: string | null = null;

  getAudioContext(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Renders an exact seamless loop buffer for the given track.
   * Extra 2.5s tail after the final beat is wrapped back into [0..2.5s] so looping is 100% seamless.
   */
  async renderSeamlessLoop(trackId: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(trackId);
    if (cached) return cached;

    const meta = MUSIC_TRACKS.find((t) => t.id === trackId) ?? MUSIC_TRACKS[0];
    const sampleRate = 44100;
    const loopDurationSec = (meta.bars * 4 * 60) / meta.bpm;
    const tailSec = 2.6;
    const totalRenderSec = loopDurationSec + tailSec;

    const offline = new OfflineAudioContext(2, Math.ceil(totalRenderSec * sampleRate), sampleRate);

    // Master bus with warm reverb + gentle limiter/compressor
    const dryGain = offline.createGain();
    dryGain.gain.value = 0.88;

    const wetGain = offline.createGain();
    wetGain.gain.value = 0.34;

    const convolver = offline.createConvolver();
    convolver.buffer = createWarmReverbIR(offline, 1.8, 2.5, meta.bpm);

    const compressor = offline.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.18;

    const masterGain = offline.createGain();
    masterGain.gain.value = 0.92;

    dryGain.connect(compressor);
    wetGain.connect(convolver);
    convolver.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(offline.destination);

    const noiseBuf = createPinkNoiseBuffer(offline, 0.6, meta.bpm * 7);
    renderTrackEvents(offline, { dry: dryGain, wet: wetGain }, noiseBuf, meta.id, meta.bpm, meta.bars);

    const rendered = await offline.startRendering();

    // Circular wrap-around: mix tail [loopSamples..] back onto [0..] for seamless infinite loop
    const loopSamples = Math.round(loopDurationSec * sampleRate);
    const tailSamples = Math.min(loopSamples, rendered.length - loopSamples);
    const finalBuf = offline.createBuffer(2, loopSamples, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const srcData = rendered.getChannelData(ch);
      const dstData = finalBuf.getChannelData(ch);
      for (let i = 0; i < loopSamples; i++) {
        let sample = srcData[i];
        if (i < tailSamples) {
          // Smooth tail blend from the end of bar 8
          sample += srcData[loopSamples + i];
        }
        // Soft clip guard
        dstData[i] = Math.tanh(sample * 0.95);
      }
    }

    this.bufferCache.set(trackId, finalBuf);
    return finalBuf;
  }

  async playPreview(trackId: string, volume = 0.75, fadeInSec = 0.4): Promise<void> {
    this.stop();
    const ctx = this.getAudioContext();
    const buffer = await this.renderSeamlessLoop(trackId);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(Math.max(0.01, volume), now + Math.max(0.05, fadeInSec));

    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);

    this.activeSource = src;
    this.activeGain = gain;
    this.currentTrackId = trackId;
  }

  setVolume(volume: number) {
    if (this.activeGain && this.ctx) {
      this.activeGain.gain.setTargetAtTime(Math.max(0, volume), this.ctx.currentTime, 0.05);
    }
  }

  stop(fadeOutSec = 0.12) {
    if (this.activeSource && this.activeGain && this.ctx) {
      const now = this.ctx.currentTime;
      const src = this.activeSource;
      const gain = this.activeGain;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + fadeOutSec);
        src.stop(now + fadeOutSec + 0.02);
      } catch {
        // ignore if already stopped
      }
    }
    this.activeSource = null;
    this.activeGain = null;
    this.currentTrackId = null;
  }

  getPlayingTrackId(): string | null {
    return this.currentTrackId;
  }
}

export const musicEngine = new MusicEngine();
