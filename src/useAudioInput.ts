import { useEffect, useRef, useState } from "react";
import { createAttackState, detectAttack, detectChord, detectPitch, type ChordResult, type PitchResult } from "./audioDetection";

export type InputStatus = "idle" | "requesting" | "listening" | "error";

export function useAudioInput() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [hasPermission, setHasPermission] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [status, setStatus] = useState<InputStatus>("idle");
  const [error, setError] = useState("");
  const [pitch, setPitch] = useState<PitchResult | null>(null);
  const [chord, setChord] = useState<ChordResult | null>(null);
  const [level, setLevel] = useState(0);
  const [passThrough, setPassThroughState] = useState(false);
  const [passThroughVolume, setPassThroughVolumeState] = useState(0.5);
  const [compressorEnabled, setCompressorEnabledState] = useState(true);
  const [compressorAmount, setCompressorAmountState] = useState(0.7);
  const [attackCount, setAttackCount] = useState(0);
  const cleanupRef = useRef<() => void>(() => undefined);
  const outputGainRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const makeupGainRef = useRef<GainNode | null>(null);
  const attackStateRef = useRef(createAttackState());

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    setDevices(allDevices.filter((device) => device.kind === "audioinput"));
  }

  async function scanDevices() {
    setStatus("requesting");
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio input requires a secure browser context (HTTPS or localhost).");
      }
      // Browsers withhold non-default devices and labels until permission is granted.
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      await refreshDevices();
      setHasPermission(true);
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Unable to scan audio inputs.");
    }
  }

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
      cleanupRef.current();
    };
  }, []);

  // Input leveler: a downward compressor tames loud playing while the make-up
  // gain lifts quiet playing, so both extremes land near a steady middle
  // level. When disabled, the compressor is set to ratio 1 with an unreachable
  // threshold (true bypass, no rewiring).
  function configureCompressor(enabled: boolean, amount: number) {
    const compressor = compressorRef.current;
    const makeupGain = makeupGainRef.current;
    if (!compressor || !makeupGain) return;
    const time = compressor.context.currentTime;
    if (!enabled) {
      compressor.threshold.setTargetAtTime(-140, time, 0.01);
      compressor.ratio.setTargetAtTime(1, time, 0.01);
      makeupGain.gain.setTargetAtTime(1, time, 0.05);
      return;
    }
    // Amount 0 keeps ratio 1 and a ceiling threshold (effectively bypass);
    // amount 1 compresses everything above -40 dBFS at 12:1 with +14 dB gain.
    compressor.threshold.setTargetAtTime(-8 - amount * 32, time, 0.02);
    compressor.knee.setTargetAtTime(amount * 30, time, 0.02);
    compressor.ratio.setTargetAtTime(1 + amount * 11, time, 0.02);
    makeupGain.gain.setTargetAtTime(1 + amount * 5, time, 0.05);
  }

  async function start(deviceId = selectedDeviceId) {
    cleanupRef.current();
    setStatus("requesting");
    setError("");
    setPitch(null);
    setChord(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio input requires a secure browser context (HTTPS or localhost). ");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      setHasPermission(true);
      const audioContext = new AudioContext({ latencyHint: "interactive" });
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 16384;
      analyser.smoothingTimeConstant = 0.45;
      const outputGain = audioContext.createGain();
      outputGain.gain.value = passThrough ? passThroughVolume : 0;
      const compressor = audioContext.createDynamicsCompressor();
      compressor.attack.value = 0.01;
      compressor.release.value = 0.25;
      const makeupGain = audioContext.createGain();
      // The compressor feeds BOTH the analyser (so quiet strums register for
      // pitch/chord/level detection) and the monitor output (consistent
      // listening volume regardless of how hard the guitar is played).
      source.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(analyser);
      makeupGain.connect(outputGain);
      outputGain.connect(audioContext.destination);
      outputGainRef.current = outputGain;
      compressorRef.current = compressor;
      makeupGainRef.current = makeupGain;
      configureCompressor(compressorEnabled, compressorAmount);

      const timeData = new Float32Array(analyser.fftSize);
      const frequencyData = new Float32Array(analyser.frequencyBinCount);
      const previousFrequencyData = new Float32Array(analyser.frequencyBinCount);
      let animationId = 0;
      let lastAnalysis = 0;

      const analyze = (now: number) => {
        animationId = requestAnimationFrame(analyze);
        if (now - lastAnalysis < 90) return;
        lastAnalysis = now;
        analyser.getFloatTimeDomainData(timeData);
        let sum = 0;
        for (const sample of timeData) sum += sample * sample;
        const normalizedLevel = Math.min(1, Math.sqrt(sum / timeData.length) * 5);
        setLevel(normalizedLevel);

        // Attack / onset detection: flag a fresh strum so ChordGame can clear
        // its needsRelease gate and accept the same chord again without
        // requiring the player to mute between strums. A strum is a fast level
        // rise on top of the ringing chord, or a broadband spectral transient
        // (which also fires when the input level is saturated and cannot rise).
        analyser.getFloatFrequencyData(frequencyData);
        let flux = 0;
        for (let bin = 0; bin < frequencyData.length; bin++) {
          const delta = frequencyData[bin] - previousFrequencyData[bin];
          if (Number.isFinite(delta) && delta > 0) flux += delta;
        }
        flux /= frequencyData.length;
        previousFrequencyData.set(frequencyData);

        const { attack, state } = detectAttack(normalizedLevel, flux, attackStateRef.current);
        attackStateRef.current = state;
        if (attack) setAttackCount((c) => c + 1);

        setPitch(detectPitch(timeData, audioContext.sampleRate));

        if (normalizedLevel < 0.04) {
          setChord(null);
        } else {
          setChord(detectChord(frequencyData, audioContext.sampleRate, analyser.fftSize));
        }
      };
      animationId = requestAnimationFrame(analyze);
      cleanupRef.current = () => {
        cancelAnimationFrame(animationId);
        stream.getTracks().forEach((track) => track.stop());
        outputGainRef.current = null;
        compressorRef.current = null;
        makeupGainRef.current = null;
        void audioContext.close();
      };
      await refreshDevices();
      const activeDevice = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (activeDevice) setSelectedDeviceId(activeDevice);
      setStatus("listening");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Unable to open the selected input.");
    }
  }

  function stop() {
    cleanupRef.current();
    cleanupRef.current = () => undefined;
    setStatus("idle");
    setPitch(null);
    setChord(null);
    setLevel(0);
  }

  function selectDevice(deviceId: string) {
    setSelectedDeviceId(deviceId);
    if (status === "listening") void start(deviceId);
  }

  function updateOutputGain(enabled: boolean, volume: number) {
    const outputGain = outputGainRef.current;
    if (!outputGain) return;
    outputGain.gain.setTargetAtTime(enabled ? volume : 0, outputGain.context.currentTime, 0.015);
  }

  function setPassThrough(enabled: boolean) {
    setPassThroughState(enabled);
    updateOutputGain(enabled, passThroughVolume);
  }

  function setPassThroughVolume(volume: number) {
    setPassThroughVolumeState(volume);
    updateOutputGain(passThrough, volume);
  }

  function setCompressorEnabled(enabled: boolean) {
    setCompressorEnabledState(enabled);
    configureCompressor(enabled, compressorAmount);
  }

  function setCompressorAmount(amount: number) {
    setCompressorAmountState(amount);
    configureCompressor(compressorEnabled, amount);
  }

  return {
    devices, hasPermission, selectedDeviceId, selectDevice, status, error, pitch, chord, level,
    attackCount,
    passThrough, setPassThrough, passThroughVolume, setPassThroughVolume,
    compressorEnabled, setCompressorEnabled, compressorAmount, setCompressorAmount,
    scanDevices, start, stop,
  };
}
