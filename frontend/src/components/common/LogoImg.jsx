import { useState } from "react";

function LogoImg({ src, alt = "", size = 18, className = "", rounded = "rounded-sm" }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`shrink-0 object-contain ${rounded} ${className}`.trim()}
      onError={() => setFailed(true)}
    />
  );
}

export default LogoImg;
