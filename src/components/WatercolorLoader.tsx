interface WatercolorBloomProps {
  label?: string;
  compact?: boolean;
}

/**
 * Airy Japanese-stationery watercolor droplet diffusion emblem.
 * Softly blooms sage-mint and milky-apricot rings on cotton paper.
 */
export function WatercolorBloom({ label, compact = false }: WatercolorBloomProps) {
  const sizeClass = compact ? 'w-11 h-11' : 'w-14 h-14';

  return (
    <div
      className="flex flex-col items-center justify-center gap-2.5 select-none"
      role="status"
      aria-live="polite"
    >
      <div className={`relative ${sizeClass} flex items-center justify-center`}>
        {/* Soft diffusing watercolor rings */}
        <span
          aria-hidden="true"
          className="wc-ripple-ring absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(74,130,118,0.28)_0%,rgba(74,130,118,0.08)_55%,transparent_75%)]"
        />
        <span
          aria-hidden="true"
          className="wc-ripple-ring wc-ripple-ring-delay-1 absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(216,178,136,0.32)_0%,rgba(216,178,136,0.1)_55%,transparent_75%)]"
        />
        <span
          aria-hidden="true"
          className="wc-ripple-ring wc-ripple-ring-delay-2 absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(122,174,162,0.24)_0%,rgba(122,174,162,0.06)_55%,transparent_75%)]"
        />
        {/* Gentle pigment droplet core */}
        <span
          aria-hidden="true"
          className="relative w-3 h-3 rounded-full bg-[#4A8276]/75 shadow-[0_0_12px_rgba(74,130,118,0.35)]"
        />
      </div>
      {label && (
        <span className="text-[11px] font-medium tracking-wider text-[#8C7B6E]">{label}</span>
      )}
    </div>
  );
}

export function WatercolorCardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-6"
      role="status"
      aria-label="正在展开手作角色展馆"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-[18px] sm:rounded-2xl studio-card overflow-hidden flex flex-col"
        >
          <div className="px-3 sm:px-4 pt-3 pb-1.5 flex items-center justify-between">
            <div className="wc-line h-2.5 w-6" />
            <div className="wc-line h-2.5 w-10" />
          </div>
          <div className="px-2.5 sm:px-4 pb-2.5">
            <div className="aspect-[3/4] rounded-xl wc-wash flex items-center justify-center">
              <WatercolorBloom compact />
            </div>
          </div>
          <div className="px-3 sm:px-4 py-3 sm:py-4 border-t border-[#F2ECE3] space-y-2.5 bg-[#FFFEFC]">
            <div className="wc-line h-4 w-2/3" />
            <div className="wc-line h-2.5 w-1/2" />
            <div className="hidden sm:block wc-line h-2.5 w-5/6 mt-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WatercolorPersonaGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-2.5 sm:gap-3"
      role="status"
      aria-label="正在加载 MBTI 人格设定"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-3 sm:p-4 rounded-xl border border-[#EAE2D6] bg-white space-y-2.5"
        >
          <div className="wc-line h-2.5 w-10" />
          <div className="wc-line h-3.5 w-2/3" />
          <div className="wc-line h-2.5 w-full" />
        </div>
      ))}
    </div>
  );
}

export function WatercolorProfileSkeleton() {
  return (
    <div className="max-w-[1120px] mx-auto px-4 sm:px-8 py-5 sm:py-10" role="status" aria-label="正在展开角色档案">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-10 items-start">
        <div className="lg:col-span-5 studio-card rounded-[22px] sm:rounded-2xl overflow-hidden">
          <div className="px-4 pt-3.5 pb-1.5 flex items-center justify-between">
            <div className="wc-line h-2.5 w-24" />
            <div className="wc-line h-2.5 w-10" />
          </div>
          <div className="px-4 pb-4">
            <div className="aspect-[4/4.3] sm:aspect-[3/4] max-h-[360px] sm:max-h-none rounded-2xl wc-wash flex items-center justify-center">
              <WatercolorBloom label="水彩档案展开中…" />
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 space-y-4 sm:space-y-6">
          <div className="studio-card rounded-[20px] sm:rounded-2xl p-5 sm:p-8 space-y-5">
            <div className="space-y-3">
              <div className="wc-line h-3 w-28" />
              <div className="wc-line h-8 w-44" />
              <div className="wc-line h-3.5 w-4/5" />
            </div>
            <div className="h-20 rounded-xl wc-wash" />
            <div className="wc-line h-11 w-full sm:w-52 rounded-xl" />
          </div>
          <div className="studio-card rounded-[20px] sm:rounded-2xl p-5 sm:p-6 space-y-3">
            <div className="wc-line h-4 w-28" />
            <div className="wc-line h-3 w-full" />
            <div className="wc-line h-3 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function WatercolorChatSkeleton() {
  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-4 md:py-7" role="status" aria-label="正在进入角色对话空间">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 studio-card rounded-[20px] sm:rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-[#EAE2D6] flex items-center gap-3">
            <div className="w-10 h-10 rounded-full wc-wash shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="wc-line h-3.5 w-28" />
              <div className="wc-line h-2.5 w-20" />
            </div>
          </div>
          <div className="p-5 min-h-[52dvh] flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 max-w-[78%]">
                <div className="w-8 h-8 rounded-full wc-wash shrink-0" />
                <div className="flex-1 h-16 rounded-[18px] rounded-tl-sm wc-wash" />
              </div>
              <div className="flex justify-end">
                <div className="w-44 h-11 rounded-[18px] rounded-tr-sm wc-wash" />
              </div>
            </div>
            <div className="py-6 flex justify-center">
              <WatercolorBloom label="正在唤起角色记忆与对话…" />
            </div>
          </div>
        </div>
        <div className="hidden lg:block lg:col-span-4 studio-card rounded-2xl p-5 space-y-4">
          <div className="wc-line h-4 w-28" />
          <div className="h-16 rounded-xl wc-wash" />
          <div className="h-16 rounded-xl wc-wash" />
        </div>
      </div>
    </div>
  );
}

export function WatercolorCardDetailSkeleton() {
  return (
    <div className="max-w-[1160px] mx-auto px-4 sm:px-8 py-5 sm:py-10 space-y-6" role="status" aria-label="正在加载作品版本与出图管理">
      <div className="space-y-2.5 border-b border-[#EAE2D6] pb-4">
        <div className="wc-line h-7 w-56" />
        <div className="wc-line h-3 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8 items-start">
        <div className="lg:col-span-6 studio-card rounded-[20px] p-4 sm:p-5">
          <div className="aspect-[4/4.3] max-h-[380px] sm:aspect-[3/4] sm:max-h-none rounded-2xl wc-wash flex items-center justify-center">
            <WatercolorBloom label="正在展开水彩手帐作品…" />
          </div>
        </div>
        <div className="lg:col-span-6 space-y-5">
          <div className="studio-card rounded-[20px] p-5 sm:p-6 space-y-4">
            <div className="wc-line h-5 w-36" />
            <div className="wc-line h-3 w-full" />
            <div className="h-20 rounded-xl wc-wash" />
            <div className="wc-line h-11 w-full rounded-xl" />
          </div>
          <div className="studio-card rounded-[20px] p-5 sm:p-6 space-y-3">
            <div className="wc-line h-5 w-32" />
            <div className="wc-line h-3 w-4/5" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function WatercolorWorksSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="正在展开我的收藏">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-6">
        {[0, 1].map((i) => (
          <div key={i} className="studio-card rounded-[20px] overflow-hidden">
            <div className="p-3">
              <div className="aspect-[3/4] rounded-xl wc-wash flex items-center justify-center">
                <WatercolorBloom compact />
              </div>
            </div>
            <div className="px-3.5 pb-4 space-y-2">
              <div className="wc-line h-4 w-2/3" />
              <div className="wc-line h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="studio-card rounded-[20px] p-5 flex items-center justify-center py-8">
        <WatercolorBloom label="正在翻开手作收藏页…" />
      </div>
    </div>
  );
}
