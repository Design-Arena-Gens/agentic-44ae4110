/* eslint-disable no-console */
"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AvatarStage } from "./AvatarStage";
import { EmotionSelector } from "./EmotionSelector";
import { emotionPresets } from "@/lib/emotions";
import { avatarPresets, type AvatarPreset } from "@/lib/presets";
import { useLipSyncEngine, type VoiceMode } from "@/hooks/useLipSyncEngine";
import styles from "./studio.module.css";

export function AvatarStudio() {
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("text");
  const [script, setScript] = useState("Hey there! Ready to create some magic?");
  const [emotion, setEmotion] = useState(emotionPresets[0]);
  const [selectedPreset, setSelectedPreset] = useState<AvatarPreset>(
    avatarPresets[0]
  );
  const [customImage, setCustomImage] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [seed, setSeed] = useState(() => Math.random());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const activeAvatar = useMemo<AvatarPreset>(() => {
    if (customImage) {
      return {
        id: "custom-image",
        label: "Custom Portrait",
        type: "image",
        image: customImage
      };
    }
    return selectedPreset;
  }, [customImage, selectedPreset]);

  const {
    startPreview,
    stopPreview,
    lipState,
    isSpeaking,
    loadAudioFile,
    ttsSupported,
    hasAudioLoaded,
    exportVideo,
    registerStageCanvas
  } = useLipSyncEngine({
    avatar: activeAvatar,
    emotion,
    script,
    seed
  });

  useEffect(() => {
    if (!isPreviewing) {
      stopPreview();
    }
  }, [isPreviewing, stopPreview]);

  const handleImageUpload = useCallback((file: File | undefined) => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setCustomImage((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return objectUrl;
    });
  }, []);

  const handleAudioUpload = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      loadAudioFile(file);
    },
    [loadAudioFile]
  );

  useEffect(() => {
    return () => {
      setCustomImage((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  const onRegenerate = useCallback(() => {
    setSeed(Math.random());
    if (isPreviewing) {
      if (voiceMode === "text" && !ttsSupported) return;
      if (voiceMode === "audio" && !hasAudioLoaded) return;
      void startPreview({ forceRestart: true, sourceMode: voiceMode });
    }
  }, [hasAudioLoaded, isPreviewing, startPreview, ttsSupported, voiceMode]);

  const onStartPreview = useCallback(() => {
    if (voiceMode === "text" && !ttsSupported) {
      return;
    }
    if (voiceMode === "audio" && !hasAudioLoaded) {
      return;
    }
    setIsPreviewing(true);
    void startPreview({ sourceMode: voiceMode });
  }, [hasAudioLoaded, startPreview, ttsSupported, voiceMode]);

  const onStopPreview = useCallback(() => {
    setIsPreviewing(false);
    stopPreview();
  }, [stopPreview]);

  const onExport = useCallback(async () => {
    try {
      const blob = await exportVideo();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "avatar-session.mp4";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (error) {
      console.error("Failed to export video", error);
    }
  }, [exportVideo]);

  return (
    <div className={styles.container}>
      <section className={styles.hero}>
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            AI Lip-Sync Avatar Studio
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6 }}
          >
            Upload a portrait or choose a stylized character, feed text or audio,
            and watch lifelike performances with expressive emotions and natural
            motion.
          </motion.p>
        </div>
        <motion.div
          className={styles.actions}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          {!isPreviewing ? (
            <button
              className={styles.primaryBtn}
              onClick={onStartPreview}
              disabled={
                (voiceMode === "audio" && !hasAudioLoaded) ||
                (voiceMode === "text" && !ttsSupported)
              }
            >
              Start Real-Time Preview
            </button>
          ) : (
            <button className={styles.secondaryBtn} onClick={onStopPreview}>
              Stop Preview
            </button>
          )}
          <button className={styles.ghostBtn} onClick={onRegenerate}>
            Regenerate
          </button>
          <button
            className={styles.outlineBtn}
            onClick={onExport}
            disabled={isSpeaking}
          >
            Export MP4
          </button>
        </motion.div>
      </section>

      <section className={styles.main}>
        <div className={styles.stageCard}>
          <AvatarStage
            avatar={activeAvatar}
            emotion={emotion}
            lipState={lipState}
            isSpeaking={isSpeaking}
            seed={seed}
            onCanvasReady={registerStageCanvas}
          />
          <div className={styles.stageMeta}>
            <div>
              <span className={styles.metaLabel}>Emotion</span>
              <strong>{emotion.label}</strong>
            </div>
            <div>
              <span className={styles.metaLabel}>Voice Mode</span>
              <strong>{voiceMode === "text" ? "Text → Speech" : "Audio Drive"}</strong>
            </div>
            <div>
              <span className={styles.metaLabel}>Status</span>
              <strong>{isSpeaking ? "Playing" : "Idle"}</strong>
            </div>
          </div>
        </div>

        <div className={styles.sidebar}>
          <div className={styles.card}>
            <header>
              <h2>Avatar Source</h2>
              <p>Upload a portrait or pick an expressive character.</p>
            </header>
            <div className={styles.presetGrid}>
              {avatarPresets.map((preset) => (
                <button
                  key={preset.id}
                  className={`${styles.presetCard} ${
                    activeAvatar.id === preset.id ? styles.activeCard : ""
                  }`}
                  onClick={() => {
                    setCustomImage(null);
                    setSelectedPreset(preset);
                  }}
                >
                  <div
                    className={styles.presetThumb}
                    style={{ background: preset.swatch ?? "#1f284a" }}
                  >
                    {preset.type === "image" && preset.image ? (
                      <Image
                        src={preset.image}
                        alt={preset.label}
                        fill
                        sizes="120px"
                      />
                    ) : (
                      <span>{preset.emoji}</span>
                    )
                  }
                  </div>
                </button>
              ))}

              <button
                className={`${styles.presetCard} ${
                  activeAvatar.id === "custom-image" ? styles.activeCard : ""
                }`}
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              >
                <div className={styles.presetThumb}>
                  <span>Upload</span>
                </div>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              onChange={(event) => handleImageUpload(event.target.files?.[0])}
            />
          </div>

          <div className={styles.card}>
            <header>
              <h2>Voice Designer</h2>
              <p>Type a script or upload an audio track to drive the performance.</p>
            </header>
            <div className={styles.voiceSwitcher}>
              <button
                className={voiceMode === "text" ? styles.voiceActive : ""}
                onClick={() => setVoiceMode("text")}
              >
                Text to Speech
              </button>
              <button
                className={voiceMode === "audio" ? styles.voiceActive : ""}
                onClick={() => setVoiceMode("audio")}
              >
                Audio Driven
              </button>
            </div>

            <AnimatePresence mode="wait">
              {voiceMode === "text" ? (
                <motion.div
                  key="text-mode"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className={styles.voicePanel}
                >
                  <textarea
                    value={script}
                    onChange={(event) => setScript(event.target.value)}
                    placeholder="Write the script the avatar should perform…"
                    rows={6}
                  />
                  <div className={styles.voiceMeta}>
                    <span>{script.length} chars</span>
                    {!ttsSupported && (
                      <span className={styles.warning}>
                        Text-to-speech not supported in this browser.
                      </span>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="audio-mode"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className={styles.voicePanel}
                >
                  <div className={styles.audioUploader}>
                    <button onClick={() => audioInputRef.current?.click()}>
                      {hasAudioLoaded ? "Replace audio" : "Upload audio"}
                    </button>
                    <span>WAV, MP3 or OGG up to 60 seconds.</span>
                  </div>
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    className={styles.hiddenInput}
                    onChange={(event) => handleAudioUpload(event.target.files?.[0])}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className={styles.card}>
            <header>
              <h2>Emotional Performance</h2>
              <p>Dial in the tone and energy of the avatar&apos;s delivery.</p>
            </header>
            <EmotionSelector value={emotion} onChange={setEmotion} />
          </div>
        </div>
      </section>
    </div>
  );
}
