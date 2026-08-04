import { useEffect, useRef, useState } from "react";
import { detectChord, detectPitch, type ChordResult, type PitchResult } from "./audioDetection";

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
  const [attackCount, setAttackCount] = useState(0);
  const cleanupRef = useRef<() => void>(() => undefined);
  const outputGainRef = useRef<GainNode | null>(null);
  const attackAverageRef = useRef(0);
  const attackCooldownRef = useRef(0);

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
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const outputGain = audioContext.createGain();
      outputGain.gain.value = passThrough ? passThroughVolume : 0;
      source.connect(outputGain);
      outputGain.connect(audioContext.destination);
      outputGainRef.current = outputGain;

      const timeData = new Float32Array(analyser.fftSize);
      const frequencyData = new Float32Array(analyser.frequencyBinCount);
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

        // Attack / onset detection: track a fast-decay EMA of the input level.
        // When the current level spikes well above the recent average, flag a new
        // strum so ChordGame can clear its needsRelease gate and accept the same
        // chord again without requiring the player to mute between strums.
        attackAverageRef.current = attackAverageRef.current * 0.9 + normalizedLevel * 0.1;
        if (attackCooldownRef.current > 0) {
          attackCooldownRef.current--;
        } else if (normalizedLevel > attackAverageRef.current * 1.8 && normalizedLevel > 0.06) {
          setAttackCount((c) => c + 1);
          attackCooldownRef.current = 2; // ~180 ms minimum between attacks
          attackAverageRef.current = normalizedLevel; // reset EMA to prevent double-fire
        }

        setPitch(detectPitch(timeData, audioContext.sampleRate));

        if (normalizedLevel < 0.06) {
          setChord(null);
        } else {
          analyser.getFloatFrequencyData(frequencyData);
          setChord(detectChord(frequencyData, audioContext.sampleRate, analyser.fftSize));
        }
      };
      animationId = requestAnimationFrame(analyze);
      cleanupRef.current = () => {
        cancelAnimationFrame(animationId);
        stream.getTracks().forEach((track) => track.stop());
        outputGainRef.current = null;
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

  return {
    devices, hasPermission, selectedDeviceId, selectDevice, status, error, pitch, chord, level,
    attackCount,
    passThrough, setPassThrough, passThroughVolume, setPassThroughVolume,
    scanDevices, start, stop,
  };
}
