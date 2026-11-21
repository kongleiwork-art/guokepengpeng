import { useEffect, useState } from 'react';

interface SafeImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackTitle?: string;
}

export function SafeImage({ src, alt, className = '', fallbackTitle }: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#F4ECE0] text-[#876E5D] select-none p-6 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <svg
          width="36"
          height="36"
          viewBox="0 0 36 36"
          fill="none"
          aria-hidden="true"
          className="mb-2 opacity-70"
        >
          <path
            d="M18 6C12.5 6 8.5 10 8.5 15C8.5 22 14.5 29 18 30.5C21.5 29 27.5 22 27.5 15C27.5 10 23.5 6 18 6Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M10 14C12.5 12 23.5 12 26 14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="15" cy="18.5" r="1.2" fill="currentColor" />
          <circle cx="21" cy="18.5" r="1.2" fill="currentColor" />
          <circle cx="18" cy="20.5" r="1.5" fill="#D16250" />
        </svg>
        <span className="text-xs font-medium tracking-wide text-[#876E5D]">
          {fallbackTitle || alt}
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {!loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-xl wc-wash transition-opacity duration-300"
        />
      )}
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`${className} transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
