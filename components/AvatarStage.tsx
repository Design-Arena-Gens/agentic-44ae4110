import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Environment, Float, Html, OrbitControls } from "@react-three/drei";
import { MathUtils, SRGBColorSpace, TextureLoader, Vector3 } from "three";
import type { Group, Mesh } from "three";
import type { EmotionPreset } from "@/lib/emotions";
import type { AvatarPreset } from "@/lib/presets";
import type { LipState } from "@/hooks/useLipSyncEngine";
import styles from "./avatar-stage.module.css";

type Props = {
  avatar: AvatarPreset;
  emotion: EmotionPreset;
  lipState: LipState;
  isSpeaking: boolean;
  seed: number;
  onCanvasReady: (canvas: HTMLCanvasElement | null) => void;
};

export function AvatarStage({
  avatar,
  emotion,
  lipState,
  isSpeaking,
  seed,
  onCanvasReady
}: Props) {
  const canvasKey = useMemo(
    () => `${avatar.id}-${emotion.id}-${Math.round(seed * 1_000)}`,
    [avatar.id, emotion.id, seed]
  );

  return (
    <div className={styles.wrapper}>
      <Canvas
        key={canvasKey}
        shadows
        dpr={[1, 1.8]}
        gl={{ preserveDrawingBuffer: true }}
        camera={{ position: [0, 1.4, 4], fov: 35 }}
        onCreated={({ gl }) => {
          gl.setClearColor("#04050c");
          gl.domElement.style.outline = "none";
          onCanvasReady(gl.domElement);
        }}
      >
        <Suspense fallback={null}>
          <StageLighting emotion={emotion} />

          <group position={[0, -0.8, 0]}>
            {avatar.type === "image" ? (
              <PortraitAvatar avatar={avatar} lipState={lipState} emotion={emotion} />
            ) : (
              <HybridAvatar avatar={avatar} lipState={lipState} emotion={emotion} seed={seed} />
            )}
          </group>

          <Float speed={1.6} rotationIntensity={0.4} floatIntensity={0.8}>
            <AmbientRibbon emotion={emotion} />
          </Float>

          <OrbitControls enablePan={false} enableZoom={false} />
          <Environment preset="night" />
        </Suspense>
      </Canvas>

      <div className={styles.hud}>
        <div className={styles.hudRow}>
          <span className={styles.dot} data-active={isSpeaking} />
          <strong>{isSpeaking ? "Synced Playback" : "Ready"}</strong>
        </div>
        <div className={styles.hudRow}>
          <span className={styles.label}>Mouth</span>
          <div className={styles.bar}>
            <div
              className={styles.barFill}
              style={{ width: `${Math.round(lipState.mouthOpen * 100)}%` }}
            />
          </div>
        </div>
        <div className={styles.hudRow}>
          <span className={styles.label}>Gesture</span>
          <div className={styles.bar}>
            <div
              className={styles.barFill}
              style={{ width: `${Math.round(lipState.handRight * 60)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StageLighting({ emotion }: { emotion: EmotionPreset }) {
  const hue = new Vector3().setScalar(1).multiplyScalar(emotion.mouthEnergy).x;
  return (
    <>
      <color attach="background" args={["#04050c"]} />
      <hemisphereLight args={["#7da6ff", "#090d21", 0.55]} />
      <spotLight
        position={[3, 6, 2]}
        angle={0.5}
        penumbra={0.6}
        intensity={1.4}
        color={emotion.color}
        castShadow
      />
      <spotLight
        position={[-3, 4, 0]}
        angle={0.4}
        penumbra={0.45}
        intensity={1.05}
        color={`hsl(${(hue * 180 + 180) % 360}, 70%, 65%)`}
      />
      <pointLight position={[0, 2, 3]} intensity={0.45} />
      <pointLight position={[0, -2, -4]} intensity={0.35} />
    </>
  );
}

function PortraitAvatar({
  avatar,
  lipState,
  emotion
}: {
  avatar: Extract<AvatarPreset, { type: "image" }>;
  lipState: LipState;
  emotion: EmotionPreset;
}) {
  const texture = useLoader(TextureLoader, avatar.image);
  texture.colorSpace = SRGBColorSpace;
  const mouthRef = useRef<Mesh>(null);
  const browRef = useRef<Mesh>(null);

  useFrame(() => {
    if (mouthRef.current) {
      mouthRef.current.scale.set(1 + lipState.mouthWidth * 0.6, 0.15 + lipState.mouthOpen * 0.7, 1);
      mouthRef.current.position.y = -0.14 - lipState.mouthOpen * 0.12;
    }
    if (browRef.current) {
      browRef.current.position.y = 0.24 + lipState.eyebrowLift * 0.12;
      browRef.current.rotation.z = -lipState.headYaw * 0.15;
    }
  });

  return (
    <group rotation={[lipState.headPitch * 0.4, lipState.headYaw * 0.4, lipState.headRoll * 0.3]}>
      <mesh position={[0, 1.35 + lipState.bodySway * 0.05, 0]} receiveShadow>
        <planeGeometry args={[1.6, 2.2, 1, 1]} />
        <meshStandardMaterial map={texture} roughness={0.7} metalness={0.05} />
      </mesh>
      <mesh
        ref={mouthRef}
        position={[0, 1.02, 0.01]}
        scale={[1, 0.2, 1]}
        rotation={[0.02, 0, 0]}
      >
        <planeGeometry args={[0.35, 0.14]} />
        <meshStandardMaterial
          color={emotion.color}
          opacity={0.65}
          transparent
          roughness={0.3}
          metalness={0.1}
        />
      </mesh>
      <mesh
        ref={browRef}
        position={[0, 1.24, 0.05]}
        scale={[1.1 + lipState.mouthWidth * 0.1, 0.1, 1]}
      >
        <planeGeometry args={[0.8, 0.09]} />
        <meshStandardMaterial color="#05060d" opacity={0.35} transparent />
      </mesh>
    </group>
  );
}

function HybridAvatar({
  avatar,
  lipState,
  emotion,
  seed
}: {
  avatar: Extract<AvatarPreset, { type: "3d" }>;
  lipState: LipState;
  emotion: EmotionPreset;
  seed: number;
}) {
  const headRef = useRef<Group>(null);
  const mouthRef = useRef<Mesh>(null);
  const leftHandRef = useRef<Group>(null);
  const rightHandRef = useRef<Group>(null);

  useFrame((_, delta) => {
    if (headRef.current) {
      headRef.current.rotation.y = lipState.headYaw * 0.5;
      headRef.current.rotation.x = -lipState.headPitch * 0.5;
      headRef.current.rotation.z = lipState.headRoll * 0.4;
      headRef.current.position.y = 1.6 + lipState.bodySway * 0.06;
    }
    if (mouthRef.current) {
      const base = 0.18 + lipState.mouthOpen * 0.5;
      mouthRef.current.scale.set(0.7 + lipState.mouthWidth * 0.4, base, 0.3);
    }
    if (leftHandRef.current) {
      leftHandRef.current.rotation.x = -0.3 + lipState.handLeft * 0.6;
      leftHandRef.current.rotation.z = 0.6 + lipState.handLeft * 0.4;
    }
    if (rightHandRef.current) {
      rightHandRef.current.rotation.x = -0.25 + lipState.handRight * 0.6;
      rightHandRef.current.rotation.z = -0.6 - lipState.handRight * 0.4;
    }
  });

  return (
    <group>
      <mesh receiveShadow castShadow position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[4, 48]} />
        <meshStandardMaterial
          color="#0a0f21"
          roughness={0.9}
          metalness={0.1}
          opacity={0.65}
          transparent
        />
      </mesh>

      <group ref={headRef}>
        <mesh castShadow position={[0, 0, 0]} scale={[1.1, 1.35, 1.1]}>
          <sphereGeometry args={[0.8, 48, 48]} />
          <meshStandardMaterial color={avatar.palette.skin} metalness={0.12} roughness={0.4} />
        </mesh>

        <group position={[0, 0.55, -0.5]} rotation={[0.2, Math.PI, 0]}>
          <mesh castShadow>
            <coneGeometry args={[0.9, 0.9, 32]} />
            <meshStandardMaterial color={avatar.palette.hair} roughness={0.35} metalness={0.2} />
          </mesh>
        </group>

        <Eye position={[-0.42, 0.25 + lipState.eyebrowLift * 0.1, 0.58]} gazeX={lipState.gazeX} gazeY={lipState.gazeY} />
        <Eye position={[0.42, 0.25 + lipState.eyebrowLift * 0.1, 0.58]} gazeX={lipState.gazeX} gazeY={lipState.gazeY} />

        <mesh
          ref={mouthRef}
          castShadow
          position={[0, -0.28, 0.7]}
          scale={[0.7, 0.2, 0.24]}
        >
          <capsuleGeometry args={[0.25, 0.15, 8, 16]} />
          <meshStandardMaterial
            color={emotion.color}
            emissive={emotion.color}
            emissiveIntensity={0.24}
            metalness={0.2}
            roughness={0.2}
          />
        </mesh>

        <mesh position={[0, -0.02, 0.65]}>
          <torusGeometry args={[0.55, 0.08, 16, 60]} />
          <meshStandardMaterial
            color={avatar.palette.outfit}
            emissive={emotion.color}
            emissiveIntensity={0.18}
            roughness={0.4}
          />
        </mesh>
      </group>

      <group position={[0, 0.35, 0]}>
        <Torso color={avatar.palette.outfit} />
      </group>

      <group ref={leftHandRef} position={[-1, 0.75, 0.3]}>
        <Hand color={avatar.palette.outfit} flipped />
      </group>
      <group ref={rightHandRef} position={[1, 0.75, 0.3]}>
        <Hand color={avatar.palette.outfit} />
      </group>
    </group>
  );
}

function Torso({ color }: { color: string }) {
  return (
    <group>
      <mesh castShadow position={[0, 0, 0]} scale={[1.4, 1.6, 0.9]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={color}
          roughness={0.45}
          metalness={0.2}
          opacity={0.95}
          transparent
        />
      </mesh>
      <mesh castShadow position={[0, -1.05, 0]} scale={[0.9, 0.4, 0.9]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0f1428" roughness={0.65} metalness={0.05} />
      </mesh>
    </group>
  );
}

function Hand({ color, flipped }: { color: string; flipped?: boolean }) {
  return (
    <group rotation={[0, flipped ? Math.PI / 2 : -Math.PI / 2, 0]}>
      <mesh castShadow scale={[0.35, 0.9, 0.35]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.25} />
      </mesh>
      <mesh castShadow position={[0, 0.7, 0]} scale={[0.3, 0.5, 0.3]}>
        <capsuleGeometry args={[0.3, 0.35, 8, 16]} />
        <meshStandardMaterial color="#f9dcc8" roughness={0.3} metalness={0.1} />
      </mesh>
    </group>
  );
}

function Eye({
  position,
  gazeX,
  gazeY
}: {
  position: [number, number, number];
  gazeX: number;
  gazeY: number;
}) {
  const pupilRef = useRef<Mesh>(null);
  useFrame(() => {
    if (pupilRef.current) {
      pupilRef.current.position.x = MathUtils.clamp(gazeX, -0.4, 0.4) * 0.12;
      pupilRef.current.position.y = MathUtils.clamp(gazeY, -0.4, 0.4) * 0.12;
    }
  });
  return (
    <group position={position}>
      <mesh castShadow>
        <sphereGeometry args={[0.18, 24, 24]} />
        <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0.05} />
      </mesh>
      <mesh ref={pupilRef} position={[0, 0, 0.15]}>
        <sphereGeometry args={[0.07, 24, 24]} />
        <meshStandardMaterial color="#222" metalness={0.3} roughness={0.4} />
      </mesh>
    </group>
  );
}

function AmbientRibbon({ emotion }: { emotion: EmotionPreset }) {
  return (
    <group>
      <mesh position={[0, 2, -2]} rotation={[-0.8, 0.4, 0.2]}>
        <torusKnotGeometry args={[1.8, 0.08, 220, 12, 2, 3]} />
        <meshStandardMaterial
          color={emotion.color}
          emissive={emotion.color}
          emissiveIntensity={0.6}
          transparent
          opacity={0.25}
        />
      </mesh>
      <Html position={[0, 3, 0]} center>
        <div className={styles.glow} />
      </Html>
    </group>
  );
}
