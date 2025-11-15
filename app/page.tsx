"use client";

import dynamic from "next/dynamic";

const AvatarStudio = dynamic(
  () => import("@/components/AvatarStudio").then((mod) => mod.AvatarStudio),
  { ssr: false }
);

export default function Page() {
  return <AvatarStudio />;
}
