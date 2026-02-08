import type { ReplyDoneSoundSource, ReplyDoneSoundTone } from "./ui-settings.ts";

const PLAY_COOLDOWN_MS = 260;
const CUSTOM_AUDIO_MAX_PLAY_MS = 4200;

type AudioContextConstructor = typeof AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const withLegacy = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? withLegacy.webkitAudioContext ?? null;
}

export type ReplyDoneSoundPlayer = {
  warmup: () => void;
  play: (options: ReplyDoneSoundPlayOptions) => void;
  dispose: () => void;
};

export type ReplyDoneSoundPlayOptions = {
  volume: number;
  tone: ReplyDoneSoundTone;
  source: ReplyDoneSoundSource;
  customAudioDataUrl: string;
};

type ToneHarmonic = {
  ratio: number;
  gain: number;
};

type ToneVoice = {
  startHz: number;
  endHz: number;
  delaySec: number;
  durationSec: number;
  attackSec: number;
  decayCurve: number;
  gain: number;
};

type ToneProfile = {
  voices: ToneVoice[];
  harmonics: ToneHarmonic[];
  masterGain: number;
  tailDelaySec: number;
  tailGain: number;
  simpleWave: OscillatorType;
  simpleStartHz: number;
  simpleEndHz: number;
  simpleDurationSec: number;
};

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0;
  }
  return Math.max(0, Math.min(100, volume));
}

function resolvePeakGain(baseGain: number, normalizedVolume: number): number {
  const loudnessBoost = 0.24 + 2.1 * Math.pow(normalizedVolume, 0.62);
  return Math.max(0.0001, Math.min(1.1, baseGain * loudnessBoost));
}

function safeDisconnect(node: AudioNode | null | undefined): void {
  if (!node) {
    return;
  }
  try {
    node.disconnect();
  } catch {
    // ignore
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

function toneProfile(tone: ReplyDoneSoundTone): ToneProfile {
  switch (tone) {
    case "glass":
      return {
        voices: [
          {
            startHz: 1318.51,
            endHz: 1328,
            delaySec: 0,
            durationSec: 0.22,
            attackSec: 0.005,
            decayCurve: 4.9,
            gain: 1,
          },
          {
            startHz: 1975.53,
            endHz: 1988,
            delaySec: 0.054,
            durationSec: 0.2,
            attackSec: 0.005,
            decayCurve: 5.1,
            gain: 0.82,
          },
          {
            startHz: 2637.02,
            endHz: 2648,
            delaySec: 0.11,
            durationSec: 0.22,
            attackSec: 0.004,
            decayCurve: 5.3,
            gain: 0.66,
          },
        ],
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2.71, gain: 0.23 },
          { ratio: 4.08, gain: 0.18 },
        ],
        masterGain: 0.5,
        tailDelaySec: 0.082,
        tailGain: 0.24,
        simpleWave: "triangle",
        simpleStartHz: 1180,
        simpleEndHz: 1700,
        simpleDurationSec: 0.21,
      };
    case "crystal":
      return {
        voices: [
          {
            startHz: 1396.91,
            endHz: 1412,
            delaySec: 0,
            durationSec: 0.19,
            attackSec: 0.004,
            decayCurve: 5.5,
            gain: 1,
          },
          {
            startHz: 2093,
            endHz: 2108,
            delaySec: 0.043,
            durationSec: 0.19,
            attackSec: 0.004,
            decayCurve: 5.7,
            gain: 0.76,
          },
          {
            startHz: 2793.83,
            endHz: 2814,
            delaySec: 0.085,
            durationSec: 0.21,
            attackSec: 0.004,
            decayCurve: 5.9,
            gain: 0.54,
          },
        ],
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2.53, gain: 0.24 },
          { ratio: 3.88, gain: 0.16 },
        ],
        masterGain: 0.48,
        tailDelaySec: 0.074,
        tailGain: 0.19,
        simpleWave: "triangle",
        simpleStartHz: 1260,
        simpleEndHz: 1780,
        simpleDurationSec: 0.19,
      };
    case "marimba":
      return {
        voices: [
          {
            startHz: 698.46,
            endHz: 704,
            delaySec: 0,
            durationSec: 0.18,
            attackSec: 0.004,
            decayCurve: 6.1,
            gain: 1,
          },
          {
            startHz: 1046.5,
            endHz: 1052,
            delaySec: 0.067,
            durationSec: 0.2,
            attackSec: 0.004,
            decayCurve: 6.4,
            gain: 0.84,
          },
        ],
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 3, gain: 0.34 },
          { ratio: 4.2, gain: 0.17 },
        ],
        masterGain: 0.66,
        tailDelaySec: 0.066,
        tailGain: 0.09,
        simpleWave: "sine",
        simpleStartHz: 780,
        simpleEndHz: 1080,
        simpleDurationSec: 0.2,
      };
    case "bell":
      return {
        voices: [
          {
            startHz: 880,
            endHz: 890,
            delaySec: 0,
            durationSec: 0.29,
            attackSec: 0.007,
            decayCurve: 3.65,
            gain: 1,
          },
          {
            startHz: 1174.66,
            endHz: 1190,
            delaySec: 0.072,
            durationSec: 0.32,
            attackSec: 0.007,
            decayCurve: 3.58,
            gain: 0.76,
          },
          {
            startHz: 1760,
            endHz: 1778,
            delaySec: 0.14,
            durationSec: 0.34,
            attackSec: 0.006,
            decayCurve: 3.42,
            gain: 0.49,
          },
        ],
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2, gain: 0.38 },
          { ratio: 2.99, gain: 0.27 },
          { ratio: 4.18, gain: 0.15 },
        ],
        masterGain: 0.52,
        tailDelaySec: 0.118,
        tailGain: 0.21,
        simpleWave: "sine",
        simpleStartHz: 860,
        simpleEndHz: 1280,
        simpleDurationSec: 0.28,
      };
    case "harp":
      return {
        voices: [
          {
            startHz: 523.25,
            endHz: 554.37,
            delaySec: 0,
            durationSec: 0.24,
            attackSec: 0.007,
            decayCurve: 4.4,
            gain: 1,
          },
          {
            startHz: 659.25,
            endHz: 698.46,
            delaySec: 0.055,
            durationSec: 0.23,
            attackSec: 0.007,
            decayCurve: 4.35,
            gain: 0.84,
          },
          {
            startHz: 783.99,
            endHz: 830.61,
            delaySec: 0.11,
            durationSec: 0.24,
            attackSec: 0.006,
            decayCurve: 4.55,
            gain: 0.66,
          },
        ],
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2, gain: 0.26 },
          { ratio: 3.02, gain: 0.14 },
        ],
        masterGain: 0.56,
        tailDelaySec: 0.095,
        tailGain: 0.16,
        simpleWave: "sine",
        simpleStartHz: 640,
        simpleEndHz: 920,
        simpleDurationSec: 0.24,
      };
    case "wood":
      return {
        voices: [
          {
            startHz: 440,
            endHz: 445,
            delaySec: 0,
            durationSec: 0.14,
            attackSec: 0.003,
            decayCurve: 7.2,
            gain: 1,
          },
          {
            startHz: 659.25,
            endHz: 665,
            delaySec: 0.055,
            durationSec: 0.13,
            attackSec: 0.003,
            decayCurve: 7.8,
            gain: 0.62,
          },
        ],
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2.9, gain: 0.31 },
          { ratio: 4.7, gain: 0.14 },
        ],
        masterGain: 0.7,
        tailDelaySec: 0.05,
        tailGain: 0.06,
        simpleWave: "triangle",
        simpleStartHz: 520,
        simpleEndHz: 760,
        simpleDurationSec: 0.16,
      };
    case "synth":
      return {
        voices: [
          {
            startHz: 880,
            endHz: 960,
            delaySec: 0,
            durationSec: 0.16,
            attackSec: 0.004,
            decayCurve: 5.2,
            gain: 1,
          },
          {
            startHz: 1174.66,
            endHz: 1280,
            delaySec: 0.045,
            durationSec: 0.17,
            attackSec: 0.004,
            decayCurve: 5.3,
            gain: 0.74,
          },
          {
            startHz: 1567.98,
            endHz: 1680,
            delaySec: 0.09,
            durationSec: 0.17,
            attackSec: 0.004,
            decayCurve: 5.45,
            gain: 0.55,
          },
        ],
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2, gain: 0.31 },
          { ratio: 5.01, gain: 0.14 },
        ],
        masterGain: 0.58,
        tailDelaySec: 0.062,
        tailGain: 0.08,
        simpleWave: "triangle",
        simpleStartHz: 900,
        simpleEndHz: 1320,
        simpleDurationSec: 0.18,
      };
    case "orb":
      return {
        voices: [
          {
            startHz: 587.33,
            endHz: 622.25,
            delaySec: 0,
            durationSec: 0.28,
            attackSec: 0.012,
            decayCurve: 2.9,
            gain: 1,
          },
          {
            startHz: 739.99,
            endHz: 783.99,
            delaySec: 0.08,
            durationSec: 0.3,
            attackSec: 0.011,
            decayCurve: 2.8,
            gain: 0.74,
          },
        ],
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2, gain: 0.22 },
          { ratio: 2.7, gain: 0.15 },
        ],
        masterGain: 0.53,
        tailDelaySec: 0.13,
        tailGain: 0.23,
        simpleWave: "sine",
        simpleStartHz: 620,
        simpleEndHz: 860,
        simpleDurationSec: 0.3,
      };
    default:
      return {
        voices: [
          {
            startHz: 1318.51,
            endHz: 1328,
            delaySec: 0,
            durationSec: 0.22,
            attackSec: 0.005,
            decayCurve: 4.9,
            gain: 1,
          },
          {
            startHz: 1975.53,
            endHz: 1988,
            delaySec: 0.054,
            durationSec: 0.2,
            attackSec: 0.005,
            decayCurve: 5.1,
            gain: 0.82,
          },
          {
            startHz: 2637.02,
            endHz: 2648,
            delaySec: 0.11,
            durationSec: 0.22,
            attackSec: 0.004,
            decayCurve: 5.3,
            gain: 0.66,
          },
        ],
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2.71, gain: 0.23 },
          { ratio: 4.08, gain: 0.18 },
        ],
        masterGain: 0.5,
        tailDelaySec: 0.082,
        tailGain: 0.24,
        simpleWave: "triangle",
        simpleStartHz: 1180,
        simpleEndHz: 1700,
        simpleDurationSec: 0.21,
      };
  }
}

function renderVoiceSample(profile: ToneProfile, voice: ToneVoice, localTimeSec: number): number {
  if (localTimeSec < 0 || localTimeSec > voice.durationSec) {
    return 0;
  }
  const duration = Math.max(1e-6, voice.durationSec);
  const progress = Math.min(1, localTimeSec / duration);
  const attack = Math.max(0.002, Math.min(duration * 0.45, voice.attackSec));
  const attackEnv = localTimeSec < attack ? localTimeSec / attack : 1;
  const decayEnv = Math.exp(-voice.decayCurve * progress);
  const hz = voice.startHz + (voice.endHz - voice.startHz) * progress;
  const twoPi = Math.PI * 2;
  let tone = 0;
  for (const harmonic of profile.harmonics) {
    tone += Math.sin(twoPi * hz * harmonic.ratio * localTimeSec) * harmonic.gain;
  }
  return tone * attackEnv * decayEnv * voice.gain;
}

function buildToneWavDataUrl(tone: ReplyDoneSoundTone): string {
  const profile = toneProfile(tone);
  const sampleRate = 32000;
  const maxVoiceEnd = profile.voices.reduce(
    (max, voice) => Math.max(max, voice.delaySec + voice.durationSec),
    0,
  );
  const durationSec = maxVoiceEnd + profile.tailDelaySec + 0.22;
  const totalSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const byteLength = 44 + totalSamples * 2;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  const delaySamples = Math.max(1, Math.floor(sampleRate * profile.tailDelaySec));
  const samples = new Float32Array(totalSamples);
  let maxAbs = 0;

  let cursor = 0;
  const writeAscii = (text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(cursor, text.charCodeAt(i));
      cursor += 1;
    }
  };
  const writeU16 = (value: number) => {
    view.setUint16(cursor, value, true);
    cursor += 2;
  };
  const writeU32 = (value: number) => {
    view.setUint32(cursor, value, true);
    cursor += 4;
  };

  writeAscii("RIFF");
  writeU32(byteLength - 8);
  writeAscii("WAVE");
  writeAscii("fmt ");
  writeU32(16);
  writeU16(1);
  writeU16(1);
  writeU32(sampleRate);
  writeU32(sampleRate * 2);
  writeU16(2);
  writeU16(16);
  writeAscii("data");
  writeU32(totalSamples * 2);

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    let dry = 0;
    for (const voice of profile.voices) {
      dry += renderVoiceSample(profile, voice, t - voice.delaySec);
    }
    let sample = dry;
    if (i >= delaySamples) {
      sample += samples[i - delaySamples] * profile.tailGain;
    }
    samples[i] = sample;
    maxAbs = Math.max(maxAbs, Math.abs(sample));
  }

  const autoGain = Math.max(0.22, Math.min(1.2, 0.82 / Math.max(0.04, maxAbs)));
  const outputGain = autoGain * profile.masterGain;
  for (let i = 0; i < totalSamples; i += 1) {
    const limited = Math.max(-1, Math.min(1, samples[i] * outputGain));
    view.setInt16(44 + i * 2, Math.round(limited * 32767), true);
  }

  return `data:audio/wav;base64,${arrayBufferToBase64(buffer)}`;
}

export function createReplyDoneSoundPlayer(): ReplyDoneSoundPlayer {
  let context: AudioContext | null = null;
  let cooldownUntil = 0;
  let unlocked = false;
  const wavDataUrlByTone = new Map<ReplyDoneSoundTone, string>();
  const activeHtmlAudio = new Set<HTMLAudioElement>();

  const ensureContext = (): AudioContext | null => {
    if (context) {
      return context;
    }
    const AudioCtor = resolveAudioContextConstructor();
    if (!AudioCtor) {
      return null;
    }
    context = new AudioCtor();
    return context;
  };

  const resumeContext = async (): Promise<AudioContext | null> => {
    const current = ensureContext();
    if (!current) {
      return null;
    }
    if (current.state === "suspended") {
      try {
        await current.resume();
      } catch {
        return null;
      }
    }
    return current.state === "running" ? current : null;
  };

  const playDesktopBeep = async (): Promise<boolean> => {
    if (!window.desktopInfo?.isDesktop || typeof window.desktopInfo.beep !== "function") {
      return false;
    }
    try {
      const result = await window.desktopInfo.beep();
      return result !== false;
    } catch {
      return false;
    }
  };

  const getWavDataUrl = (tone: ReplyDoneSoundTone): string => {
    const cached = wavDataUrlByTone.get(tone);
    if (cached) {
      return cached;
    }
    const generated = buildToneWavDataUrl(tone);
    wavDataUrlByTone.set(tone, generated);
    return generated;
  };

  const playHtmlAudioDataUrl = async (
    dataUrl: string,
    normalizedVolume: number,
    maxPlayMs?: number,
  ): Promise<boolean> => {
    let audio: HTMLAudioElement | null = null;
    let timeoutId: number | null = null;
    const cleanup = () => {
      if (!audio) {
        return;
      }
      audio.onended = null;
      audio.onpause = null;
      audio.onerror = null;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      activeHtmlAudio.delete(audio);
    };
    try {
      if (!dataUrl || normalizedVolume <= 0) {
        return true;
      }
      audio = new Audio(dataUrl);
      audio.preload = "auto";
      audio.volume = Math.max(0, Math.min(1, normalizedVolume));
      activeHtmlAudio.add(audio);
      audio.onended = cleanup;
      audio.onpause = cleanup;
      audio.onerror = cleanup;
      if (typeof maxPlayMs === "number" && maxPlayMs > 0) {
        timeoutId = window.setTimeout(() => {
          try {
            audio.pause();
          } catch {
            // ignore
          }
          cleanup();
        }, maxPlayMs);
      }
      await audio.play();
      return true;
    } catch {
      if (audio) {
        try {
          audio.pause();
        } catch {
          // ignore
        }
      }
      cleanup();
      return false;
    }
  };

  const playHtmlTone = async (options: ReplyDoneSoundPlayOptions): Promise<boolean> => {
    const normalized = clampVolume(options.volume) / 100;
    return playHtmlAudioDataUrl(getWavDataUrl(options.tone), normalized);
  };

  const playCustomHtmlAudio = async (options: ReplyDoneSoundPlayOptions): Promise<boolean> => {
    if (!options.customAudioDataUrl) {
      return false;
    }
    const normalized = clampVolume(options.volume) / 100;
    return playHtmlAudioDataUrl(options.customAudioDataUrl, normalized, CUSTOM_AUDIO_MAX_PLAY_MS);
  };

  const scheduleVoice = (params: {
    context: AudioContext;
    destination: AudioNode;
    harmonics: ToneHarmonic[];
    startHz: number;
    endHz: number;
    startAt: number;
    durationSec: number;
    peakGain: number;
    attackSec: number;
    decayCurve: number;
  }): number => {
    const endAt = params.startAt + params.durationSec;
    const attackSec = Math.max(0.004, Math.min(params.durationSec * 0.44, params.attackSec));
    const sustainFactor = Math.max(0.18, Math.min(0.72, Math.exp(-params.decayCurve * 0.56)));
    const env = params.context.createGain();
    env.gain.setValueAtTime(0.0001, params.startAt);
    env.gain.exponentialRampToValueAtTime(params.peakGain, params.startAt + attackSec);
    env.gain.exponentialRampToValueAtTime(
      params.peakGain * sustainFactor,
      params.startAt + params.durationSec * 0.54,
    );
    env.gain.exponentialRampToValueAtTime(0.0001, endAt);
    env.connect(params.destination);

    const harmonics = params.harmonics.length > 0 ? params.harmonics : [{ ratio: 1, gain: 1 }];
    let pending = harmonics.length;
    for (const harmonic of harmonics) {
      const harmonicGain = params.context.createGain();
      harmonicGain.gain.setValueAtTime(harmonic.gain, params.startAt);
      harmonicGain.connect(env);

      const voice = params.context.createOscillator();
      voice.type = "sine";
      voice.frequency.setValueAtTime(params.startHz * harmonic.ratio, params.startAt);
      voice.frequency.exponentialRampToValueAtTime(
        params.endHz * harmonic.ratio,
        params.startAt + params.durationSec * 0.86,
      );
      voice.connect(harmonicGain);
      voice.start(params.startAt);
      voice.stop(endAt);
      voice.onended = () => {
        safeDisconnect(voice);
        safeDisconnect(harmonicGain);
        pending -= 1;
        if (pending <= 0) {
          safeDisconnect(env);
        }
      };
    }

    return endAt;
  };

  const playSimpleFallbackTone = (
    active: AudioContext,
    options: ReplyDoneSoundPlayOptions,
    normalizedVolume: number,
  ): boolean => {
    const profile = toneProfile(options.tone);
    const now = active.currentTime;
    const wave = profile.simpleWave;
    const startHz = profile.simpleStartHz;
    const endHz = profile.simpleEndHz;
    const durationSec = profile.simpleDurationSec;
    const gain = active.createGain();
    const peak = Math.max(
      0.0001,
      Math.min(1.1, (0.74 * profile.masterGain) * Math.pow(normalizedVolume, 0.86)),
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    gain.connect(active.destination);

    const osc = active.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(endHz, now + durationSec * 0.82);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + durationSec);
    osc.onended = () => {
      safeDisconnect(osc);
      safeDisconnect(gain);
    };
    return true;
  };

  const unlockAudio = async (): Promise<void> => {
    if (unlocked) {
      return;
    }
    const active = await resumeContext();
    if (!active) {
      return;
    }
    const now = active.currentTime;
    const gain = active.createGain();
    gain.gain.setValueAtTime(0.00001, now);
    gain.connect(active.destination);
    const osc = active.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.01);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    unlocked = true;
  };

  const playWebTone = async (options: ReplyDoneSoundPlayOptions): Promise<boolean> => {
    const normalizedVolume = clampVolume(options.volume) / 100;
    if (normalizedVolume <= 0) {
      return true;
    }
    const active = await resumeContext();
    if (!active) {
      return false;
    }
    try {
      const profile = toneProfile(options.tone);
      const now = active.currentTime + 0.004;
      const master = active.createGain();
      const masterGain = Math.max(
        0.05,
        Math.min(1.3, (0.2 + 1.04 * Math.pow(normalizedVolume, 0.74)) * profile.masterGain),
      );
      master.gain.setValueAtTime(masterGain, now);

      const echoDelay = active.createDelay(0.5);
      echoDelay.delayTime.setValueAtTime(Math.max(0.02, Math.min(0.4, profile.tailDelaySec)), now);
      const echoGain = active.createGain();
      echoGain.gain.setValueAtTime(Math.max(0, Math.min(0.4, profile.tailGain * 0.8)), now);

      master.connect(active.destination);
      master.connect(echoDelay);
      echoDelay.connect(echoGain);
      echoGain.connect(active.destination);

      let endAt = now;
      for (const voice of profile.voices) {
        const voiceEnd = scheduleVoice({
          context: active,
          destination: master,
          harmonics: profile.harmonics,
          startHz: voice.startHz,
          endHz: voice.endHz,
          startAt: now + voice.delaySec,
          durationSec: voice.durationSec,
          peakGain: resolvePeakGain(0.38 * voice.gain, normalizedVolume),
          attackSec: voice.attackSec,
          decayCurve: voice.decayCurve,
        });
        endAt = Math.max(endAt, voiceEnd);
      }

      const cleanupDelayMs = Math.max(
        36,
        Math.ceil((endAt + profile.tailDelaySec + 0.1 - active.currentTime) * 1000),
      );
      window.setTimeout(() => {
        safeDisconnect(master);
        safeDisconnect(echoDelay);
        safeDisconnect(echoGain);
      }, cleanupDelayMs);
      return true;
    } catch {
      return playSimpleFallbackTone(active, options, normalizedVolume);
    }
  };

  return {
    warmup() {
      void unlockAudio();
    },
    play(options) {
      const now = Date.now();
      if (now < cooldownUntil) {
        return;
      }
      cooldownUntil = now + PLAY_COOLDOWN_MS;
      void (async () => {
        const playBuiltIn = async (): Promise<boolean> => {
          const webPlayed = await playWebTone(options);
          if (webPlayed) {
            return true;
          }
          return playHtmlTone(options);
        };
        try {
          if (options.source === "custom") {
            const customPlayed = await playCustomHtmlAudio(options);
            if (customPlayed) {
              return;
            }
          }
          const builtinPlayed = await playBuiltIn();
          if (!builtinPlayed) {
            await playDesktopBeep();
          }
        } catch {
          const customPlayed = options.source === "custom" ? await playCustomHtmlAudio(options) : false;
          if (customPlayed) {
            return;
          }
          const htmlPlayed = await playHtmlTone(options);
          if (!htmlPlayed) {
            await playDesktopBeep();
          }
        }
      })();
    },
    dispose() {
      for (const audio of activeHtmlAudio) {
        try {
          audio.pause();
        } catch {
          // ignore
        }
      }
      activeHtmlAudio.clear();
      wavDataUrlByTone.clear();
      const current = context;
      context = null;
      if (current) {
        void current.close().catch(() => undefined);
      }
    },
  };
}
