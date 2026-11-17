import { useState, type ReactNode } from "react";

/** `children` lie over the picture, e.g. a moving one. */
export function ProfileAvatar({ name, uri, children }: { name: string; uri?: string | null | undefined; children?: ReactNode }) {
  const [failed, setFailed] = useState<string>();
  const source = uri ?? "";
  const image = source.startsWith("data:image/jpeg;base64,") && source.length <= 20000 && failed !== source;
  return <span className="listen-avatar" aria-hidden="true">
    {image ? <img src={source} alt="" onError={() => setFailed(source)} /> : Array.from(name.trim())[0]?.toUpperCase() || "♪"}
    {children}
  </span>;
}
