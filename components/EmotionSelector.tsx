import { motion } from "framer-motion";
import { emotionPresets, type EmotionPreset } from "@/lib/emotions";
import styles from "./emotion-selector.module.css";

type Props = {
  value: EmotionPreset;
  onChange: (preset: EmotionPreset) => void;
};

export function EmotionSelector({ value, onChange }: Props) {
  return (
    <div className={styles.grid}>
      {emotionPresets.map((preset) => {
        const active = preset.id === value.id;
        return (
          <motion.button
            key={preset.id}
            className={`${styles.card} ${active ? styles.active : ""}`}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onChange(preset)}
            style={
              active
                ? {
                    boxShadow: `0 18px 40px ${preset.color}33`,
                    borderColor: `${preset.color}aa`
                  }
                : undefined
            }
          >
            <div className={styles.pill} style={{ background: preset.color }}>
              {preset.label}
            </div>
            <p>{preset.description}</p>
          </motion.button>
        );
      })}
    </div>
  );
}
