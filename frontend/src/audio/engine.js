// 音频引擎单例 - 管理 AudioContext + Analyser + Audio 元素
let audio = null;
let audioCtx = null;
let analyser = null;
let source = null;
let connected = false;
let rawFreq = null;

export function getAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    // Sonus 只作为 Android App 运行，QQ 音乐音源没有 CORS 头，
    // 设置 crossOrigin 会导致 Audio 加载失败。这里不设置 crossOrigin，
    // 让 Audio 元素直接请求播放；Web Audio 的 MediaElementSource 会连接失败，
    // 可视化自动退化为待机动画。
  }
  return audio;
}

export function initAudioSystem() {
  const a = getAudio();

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
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -15;
  }

  if (!connected) {
    try {
      source = audioCtx.createMediaElementSource(a);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      connected = true;
    } catch (e) {
      // 跨域限制导致无法连接 Web Audio，可视化会显示待机效果
      console.warn('Web Audio connect failed', e);
      connected = false;
    }
  }

  return { audio: a, audioCtx, analyser };
}

export function getAnalyser() {
  return analyser;
}

export function getSpectrumBars(numBars = 64) {
  if (!analyser) {
    const t = Date.now() * 0.001;
    const data = new Float32Array(numBars);
    for (let i = 0; i < numBars; i++) {
      data[i] = (Math.sin(i * 0.2 + t * 1.8) * 0.5 + 0.5) * 0.15;
    }
    return { data, hasData: false };
  }

  const bins = analyser.frequencyBinCount;
  if (!rawFreq || rawFreq.length !== bins) {
    rawFreq = new Uint8Array(bins);
  }
  analyser.getByteFrequencyData(rawFreq);

  const usableBins = bins - 2;
  const startBin = 2;
  const result = new Float32Array(numBars);
  const logMin = 0;
  const logMax = Math.log(usableBins);
  let totalEnergy = 0;

  for (let i = 0; i < numBars; i++) {
    const ratio0 = i / numBars;
    const ratio1 = (i + 1) / numBars;
    const binStart = Math.floor(Math.exp(logMin + ratio0 * (logMax - logMin)));
    const binEnd = Math.max(binStart + 1, Math.floor(Math.exp(logMin + ratio1 * (logMax - logMin))));
    const clampedEnd = Math.min(binEnd, usableBins);

    let peak = 0;
    let sum = 0;
    let count = 0;
    for (let j = startBin + binStart; j < startBin + clampedEnd; j++) {
      if (rawFreq[j] > peak) peak = rawFreq[j];
      sum += rawFreq[j];
      count++;
    }

    const avg = count > 0 ? sum / count : 0;
    const combined = peak * 0.7 + avg * 0.3;
    const normalized = combined / 255;
    const corrected = Math.pow(normalized, 0.6);
    result[i] = corrected;
    totalEnergy += normalized;
  }

  const hasData = totalEnergy > numBars * 0.02;
  return { data: result, hasData };
}

export function readFrequencyData() {
  if (!analyser) return new Uint8Array(0);
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);
  return dataArray;
}

export function readTimeDomainData() {
  if (!analyser) return new Uint8Array(0);
  const arr = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(arr);
  return arr;
}

export function readFrequencyDataLog(numBars = 64) {
  return getSpectrumBars(numBars);
}
