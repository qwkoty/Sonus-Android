// 音频引擎单例 - 管理 AudioContext + Analyser + Audio 元素
let audio = null;
let audioCtx = null;
let analyser = null;
let source = null;
let connected = false;

export function getAudio() {
  if (!audio) {
    audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
  }
  return audio;
}

export function initAudioSystem() {
  const a = getAudio();

  // 创建 AudioContext（必须在用户交互后）
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return { audio: a, audioCtx: null, analyser: null };
    audioCtx = new AC();
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  if (!analyser) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128; // 64 bins usable
    analyser.smoothingTimeConstant = 0.85;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
  }

  // 一个 audio 元素只能连接一次 MediaElementSource
  if (!connected) {
    try {
      source = audioCtx.createMediaElementSource(a);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      connected = true;
    } catch (e) {
      // 可能已经连接过（如热重载），忽略
    }
  }

  return { audio: a, audioCtx, analyser };
}

export function getAnalyser() {
  return analyser;
}

export function getAudioContext() {
  return audioCtx;
}

export function readFrequencyData() {
  if (!analyser) return new Uint8Array(0);
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);
  return dataArray;
}
