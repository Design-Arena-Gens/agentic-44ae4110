"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EmotionPreset } from "@/lib/emotions";
import type { AvatarPreset } from "@/lib/presets";

export type VoiceMode = "text" | "audio";

export type LipState = {
  mouthOpen: number;
  mouthWidth: number;
  blink: number;
  eyebrowLift: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  gazeX: number;
  gazeY: number;
  handLeft: number;
  handRight: number;
  bodySway: number;
};

const initialLipState: LipState = {
  mouthOpen: 0.1,
  mouthWidth: 0.1,
  blink: 0,
  eyebrowLift: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  gazeX: 0,
  gazeY: 0,
  handLeft: 0,
  handRight: 0,
  bodySway: 0
};

const EXPORT_DURATION_MS = 8000;

type UseLipSyncEngineProps = {
  emotion: EmotionPreset;
  script: string;
  avatar: AvatarPreset;
  seed: number;
};

type StartPreviewOptions = {
  forceRestart?: boolean;
  sourceMode?: VoiceMode;
  fromExport?: boolean;
};

type VisemeFrame = {
  time: number;
  mouth: number;
  width: number;
};

type ExportResult = Blob | null;

const hasWindow = typeof window !== "undefined";

const createSeeder = (seed: number) => {
  let value = seed * 10_000;
  return () => {
    value = Math.sin(value + 0.12345) * 43758.5453;
    return value - Math.floor(value);
  };
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getWords = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

const estimateWordDuration = (emotion: EmotionPreset) => {
  const base = 0.42;
  const energyOffset = (emotion.mouthEnergy - 0.5) * 0.2;
  const handOffset = emotion.handAmplitude * 0.05;
  return clamp(base - energyOffset - handOffset, 0.28, 0.6);
};

const buildVisemeTimeline = (
  text: string,
  emotion: EmotionPreset,
  seed: number
) => {
  const words = getWords(text);
  const random = createSeeder(seed);
  const frames: VisemeFrame[] = [];
  if (!words.length) {
    const fallbackDuration = 2.5;
    const frameCount = Math.floor(fallbackDuration * 60);
    for (let i = 0; i < frameCount; i += 1) {
      const t = i / 60;
      frames.push({
        time: t,
        mouth: 0.2 + random() * 0.15,
        width: 0.3 + random() * 0.15
      });
    }
    return { frames, duration: fallbackDuration };
  }

  const wordDuration = estimateWordDuration(emotion);
  const duration = Math.max(words.length * wordDuration + 1.2, 2);
  const frameCount = Math.floor(duration * 60);

  const peaks = words.map((word, index) => {
    const vowelWeight = (word.match(/[aeiouy]/gi)?.length ?? 1) / word.length;
    const consonantStrength = (word.match(/[pbmfvl]/gi)?.length ?? 0) * 0.15;
    const base = 0.45 + (emotion.mouthEnergy - 0.5) * 0.4;
    const noise = (random() - 0.5) * 0.25;
    return {
      time: clamp((index * wordDuration) + random() * 0.05, 0, duration),
      mouth: clamp(base + vowelWeight * 0.35 + consonantStrength + noise, 0, 1),
      width: clamp(0.35 + vowelWeight * 0.2 + (emotion.mouthEnergy - 0.5), 0, 1)
    };
  });

  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame / 60;
    let mouth = 0.12;
    let width = 0.3;
    for (const peak of peaks) {
      const diff = Math.abs(t - peak.time);
      const influence = Math.exp(-((diff ** 2) / 0.08));
      mouth += peak.mouth * influence;
      width += peak.width * influence * 0.7;
    }
    mouth *= 0.55 + random() * 0.1;
    width *= 0.45 + random() * 0.1;
    mouth = clamp(mouth, 0.05, 1);
    width = clamp(width, 0.05, 0.95);
    frames.push({ time: t, mouth, width });
  }

  return { frames, duration };
};

const sampleViseme = (timeline: VisemeFrame[], elapsed: number) => {
  if (!timeline.length) return { mouth: 0.1, width: 0.3 };
  const total = timeline[timeline.length - 1]?.time ?? elapsed;
  if (elapsed >= total) return timeline[timeline.length - 1];
  const index = timeline.findIndex((frame) => frame.time >= elapsed);
  if (index <= 0) return timeline[0];
  const prev = timeline[index - 1];
  const current = timeline[index];
  const span = current.time - prev.time || 1;
  const weight = clamp((elapsed - prev.time) / span, 0, 1);
  return {
    mouth: prev.mouth + (current.mouth - prev.mouth) * weight,
    width: prev.width + (current.width - prev.width) * weight
  };
};

export const useLipSyncEngine = ({
  emotion,
  script,
  avatar,
  seed
}: UseLipSyncEngineProps) => {
  const [lipState, setLipState] = useState<LipState>(initialLipState);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasAudioLoaded, setHasAudioLoaded] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);

  const modeRef = useRef<VoiceMode>("text");
  const rafRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const visemeTimelineRef = useRef<VisemeFrame[]>([]);
  const visemeDurationRef = useRef<number>(0);
  const exportResolveRef = useRef<(() => void) | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioDataRef = useRef<Uint8Array | null>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const randomRef = useRef(createSeeder(seed));

  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!hasWindow) return;
    setTtsSupported("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined");
  }, []);

  useEffect(() => {
    if (!hasWindow) return;
    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;
    const cleanup = () => {
      audio.pause();
      audio.src = "";
    };
    return cleanup;
  }, []);

  useEffect(() => {
    randomRef.current = createSeeder(seed + (emotion.mouthEnergy * 100));
  }, [seed, emotion]);

  const ensureAudioContext = useCallback(() => {
    if (!hasWindow) return null;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const ensureAnalyser = useCallback(() => {
    const ctx = ensureAudioContext();
    const audio = audioRef.current;
    if (!ctx || !audio) return null;
    if (!analyserRef.current) {
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const bufferLength = analyser.frequencyBinCount;
      const arrayBuffer = new ArrayBuffer(bufferLength);
      audioDataRef.current = new Uint8Array(arrayBuffer);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
    }
    return analyserRef.current;
  }, [ensureAudioContext]);

  const stopSpeechSynthesis = useCallback(() => {
    if (!ttsSupported) return;
    if (ttsUtteranceRef.current) {
      window.speechSynthesis.cancel();
      ttsUtteranceRef.current = null;
    }
  }, [ttsSupported]);

  const cleanupRAF = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
  }, []);

  const resetLipState = useCallback(() => {
    setLipState((prev) => ({
      ...prev,
      mouthOpen: 0.12,
      mouthWidth: 0.2,
      handLeft: 0,
      handRight: 0,
      bodySway: 0
    }));
  }, []);

  const shutdownPlayback = useCallback(() => {
    cleanupRAF();
    stopSpeechSynthesis();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsSpeaking(false);
    exportResolveRef.current?.();
    exportResolveRef.current = null;
  }, [cleanupRAF, stopSpeechSynthesis]);

  useEffect(() => shutdownPlayback, [shutdownPlayback]);

  const updateLoop = useCallback(
    (timestamp: number) => {
      const analyser = analyserRef.current;
      const dataArray = audioDataRef.current;
      const random = randomRef.current;
      let mouth = 0.15;
      let width = 0.2;
      const elapsed = (timestamp - startTimeRef.current) / 1000;

      if (modeRef.current === "audio" && analyser && dataArray) {
        const byteArray = dataArray as unknown as Uint8Array<ArrayBuffer>;
        analyser.getByteTimeDomainData(byteArray);
        let sum = 0;
        for (let i = 0; i < byteArray.length; i += 1) {
          const value = (byteArray[i] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / byteArray.length);
        mouth = clamp(rms * 4 + emotion.mouthEnergy * 0.35, 0.05, 1);
        width = clamp(rms * 2.8 + 0.25, 0.05, 0.9);
      } else {
        const viseme = sampleViseme(visemeTimelineRef.current, elapsed);
        mouth = viseme.mouth;
        width = viseme.width;
        if (visemeDurationRef.current && elapsed > visemeDurationRef.current + 0.4) {
          shutdownPlayback();
          return;
        }
      }

      const blinkSpeed = 0.45 + random() * 0.35;
      const blinkPhase = Math.sin(timestamp / (1300 + random() * 400) + seed);
      const blink = clamp(Math.pow(Math.abs(blinkPhase), 12) * (0.8 + random() * 0.4), 0, 1);

      const emotionInfluence = emotion.handAmplitude;
      const headYaw =
        Math.sin(timestamp / (2300 + emotion.gazeIntensity * 300) + seed) * 0.25 +
        mouth * 0.08 * (emotion.gazeIntensity + 0.2);
      const headPitch =
        Math.sin(timestamp / (3100 + random() * 500)) * 0.18 +
        (emotion.browLift * 0.15 - 0.05);
      const headRoll = Math.sin(timestamp / (4100 + random() * 500)) * 0.14;
      const gazeX =
        Math.sin(timestamp / (1600 + random() * 600)) * 0.45 * (emotion.gazeIntensity + 0.3);
      const gazeY =
        Math.sin(timestamp / (2100 + random() * 700) + 0.5) * 0.35 * (emotion.gazeIntensity + 0.2);
      const handLeft =
        mouth * (0.5 + emotionInfluence) + Math.sin(timestamp / 800 + random() * 2) * 0.2;
      const handRight =
        mouth * (0.45 + emotionInfluence * 1.1) + Math.sin(timestamp / 900 + random() * 2) * 0.25;
      const bodySway = Math.sin(timestamp / 2500) * 0.25 + mouth * 0.2;

      setLipState({
        mouthOpen: mouth,
        mouthWidth: width,
        blink: blink * (1 - emotion.gazeIntensity * 0.2),
        eyebrowLift: emotion.browLift + mouth * 0.25,
        headYaw,
        headPitch,
        headRoll,
        gazeX,
        gazeY,
        handLeft,
        handRight,
        bodySway
      });

      rafRef.current = requestAnimationFrame(updateLoop);
    },
    [emotion, seed, shutdownPlayback]
  );

  const startPreview = useCallback(
    async (options?: StartPreviewOptions) => {
      const sourceMode = options?.sourceMode ?? modeRef.current;
      modeRef.current = sourceMode;
      if (!options?.fromExport) {
        resetLipState();
      }
      if (!options?.forceRestart && isSpeaking) return;

      cleanupRAF();

      const now = performance.now();
      startTimeRef.current = now;

      if (sourceMode === "audio") {
        const analyser = ensureAnalyser();
        if (!analyser || !hasAudioLoaded) return;
        const ctx = audioContextRef.current;
        if (ctx?.state === "suspended") {
          await ctx.resume();
        }
        const audio = audioRef.current;
        if (!audio) return;
        audio.currentTime = 0;
        await audio.play();
        setIsSpeaking(true);
        rafRef.current = requestAnimationFrame(updateLoop);
        audio.onended = () => {
          shutdownPlayback();
        };
      } else {
        if (!ttsSupported) return;
        stopSpeechSynthesis();
        const text = script.trim() || "Hello, the stage is ready.";
        const { frames, duration } = buildVisemeTimeline(text, emotion, seed);
        visemeTimelineRef.current = frames;
        visemeDurationRef.current = duration;

        const utterance = new SpeechSynthesisUtterance(text);
        const pitchBase = 1 + (emotion.browLift * 0.5);
        const rateBase = 1 + (emotion.mouthEnergy - 0.5) * 0.4;
        const volumeBase = clamp(0.8 + emotion.handAmplitude * 0.3, 0.4, 1);
        utterance.pitch = clamp(pitchBase, 0.6, 1.6);
        utterance.rate = clamp(rateBase, 0.7, 1.5);
        utterance.volume = volumeBase;
        ttsUtteranceRef.current = utterance;
        utterance.onend = () => {
          shutdownPlayback();
        };

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        setIsSpeaking(true);
        rafRef.current = requestAnimationFrame(updateLoop);
      }
    },
    [
      cleanupRAF,
      isSpeaking,
      ensureAnalyser,
      hasAudioLoaded,
      updateLoop,
      ttsSupported,
      stopSpeechSynthesis,
      script,
      emotion,
      seed,
      resetLipState,
      shutdownPlayback
    ]
  );

  const stopPreview = useCallback(() => {
    shutdownPlayback();
    resetLipState();
  }, [resetLipState, shutdownPlayback]);

  const loadAudioFile = useCallback(
    (file: File) => {
      if (!hasWindow) return;
      const audio = audioRef.current;
      if (!audio) return;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      audio.src = objectUrl;
      audio.load();
      setHasAudioLoaded(true);
    },
    []
  );

  const registerStageCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    stageCanvasRef.current = canvas;
  }, []);

  const exportVideo = useCallback(async (): Promise<ExportResult> => {
    if (!hasWindow) return null;
    const canvas = stageCanvasRef.current;
    if (!canvas) return null;

    const stream = canvas.captureStream(60);
    const audioEl = audioRef.current;
    try {
      if (modeRef.current === "audio" && audioEl && "captureStream" in audioEl) {
        const audioStream = (audioEl as HTMLMediaElement & {
          captureStream?: () => MediaStream;
        }).captureStream?.();
        if (audioStream?.getAudioTracks().length) {
          const [track] = audioStream.getAudioTracks();
          stream.addTrack(track);
        }
      }
    } catch {
      // ignore capture failures
    }

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp9"
    });
    const exportPromise = new Promise<void>((resolve) => {
      exportResolveRef.current = resolve;
    });

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.start();

    await startPreview({ forceRestart: true, fromExport: true });
    await new Promise((resolve) => setTimeout(resolve, EXPORT_DURATION_MS));
    recorder.stop();
    shutdownPlayback();
    await exportPromise;

    const webmBlob = new Blob(chunks, { type: "video/webm" });

    const convertWebmToMp4 = async () => {
      try {
        const ffmpegImport = (await import("@ffmpeg/ffmpeg")) as any;
        const { createFFmpeg, fetchFile } = ffmpegImport;
        if (!hasWindow) return webmBlob;
        const ffmpegModule = createFFmpeg({
          log: false,
          corePath: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js"
        });
        if (!ffmpegModule.isLoaded()) {
          await ffmpegModule.load();
        }
        ffmpegModule.FS("writeFile", "input.webm", await fetchFile(webmBlob));
        await ffmpegModule.run(
          "-i",
          "input.webm",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "output.mp4"
        );
        const data = ffmpegModule.FS("readFile", "output.mp4");
        ffmpegModule.FS("unlink", "input.webm");
        ffmpegModule.FS("unlink", "output.mp4");
        return new Blob([data.buffer], { type: "video/mp4" });
      } catch (error) {
        console.error("ffmpeg conversion failed, returning webm", error);
        return webmBlob;
      }
    };

    return convertWebmToMp4();
  }, [shutdownPlayback, startPreview]);

  useEffect(() => () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
  }, []);

  return {
    lipState,
    isSpeaking,
    startPreview,
    stopPreview,
    loadAudioFile,
    hasAudioLoaded,
    ttsSupported,
    registerStageCanvas,
    exportVideo,
    audioElement: audioRef.current
  };
};
