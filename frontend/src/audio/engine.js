// 音频引擎单例 - 管理 AudioContext + Analyser + Audio 元素
let audio = null;
let audioCtx = null;
let analyser = null;
let source = null;
let connected = false;
let rawFreq = null;
let spectrumBuf = null; // 频谱结果复用缓冲，避免每帧 new Float32Array 引发 GC 抖动

export function getAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    // 代理服务器返回 Access-Control-Allow-Origin: *，设 crossOrigin 后
    // Web Audio 的 createMediaElementSource 能正常读取音频数据（否则跨域静音）
    audio.crossOrigin = 'anonymous';
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
    analyser.smoothingTimeConstant = 0.72; // 0.65→0.72：折中（比原 0.75 略跟手，但不抖）（v1.22）
    analyser.minDecibels = -100;           // -90→-100：安静段也能看到起伏
    analyser.maxDecibels = -10;            // -15→-10：峰值不再被压平
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

export function getSpectrumBars(numBars = 64, gain = 1.04) { // gain 1.12→1.04：微提亮即可，不过曝（v1.22）
  if (!spectrumBuf || spectrumBuf.length !== numBars) {
    spectrumBuf = new Float32Array(numBars);
  }
  if (!analyser) {
    const t = Date.now() * 0.001;
    const data = spectrumBuf;
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
  const result = spectrumBuf;
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
    const corrected = Math.min(1, Math.pow(normalized, 0.58) * gain); // 0.55→0.58：安静段更暗、对比更强（v1.22）
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
