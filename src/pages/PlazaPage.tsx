import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowUpRight, MessageSquare, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import type { DollSummary, PersonaPublic } from '../lib/types';
import { WatercolorPersonaGridSkeleton } from '../components/WatercolorLoader';
import { haptic } from '../lib/haptics';

type GroupFilter = 'ALL' | 'NF' | 'NT' | 'SJ' | 'SP';

const GROUP_META: Array<{
  key: GroupFilter;
  label: string;
  subtitle: string;
  accent: string;
}> = [
  { key: 'ALL', label: '全部 16 型', subtitle: '完整果壳人格标本谱', accent: '#4A8276' },
  { key: 'NF', label: 'NF 理想', subtitle: '温柔疗愈与灵感共鸣', accent: '#4A8276' },
  { key: 'NT', label: 'NT 理性', subtitle: '洞见系统与思辨火花', accent: '#6B638C' },
  { key: 'SJ', label: 'SJ 守护', subtitle: '井然秩序与踏实陪伴', accent: '#B37E38' },
  { key: 'SP', label: 'SP 探索', subtitle: '热忱行动与即兴感知', accent: '#B85D43' },
];

const GROUP_BADGE_STYLE: Record<string, string> = {
  NF: 'text-[#2D6458] bg-[#E8F4F0] border-[#C6E2DA]',
  NT: 'text-[#554D78] bg-[#EFEDF6] border-[#D8D3EA]',
  SJ: 'text-[#8C5F22] bg-[#FAF1E2] border-[#E8D5B5]',
  SP: 'text-[#96452E] bg-[#FBECE7] border-[#ECC8BC]',
};

const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

export function PlazaPage() {
  const [personas, setPersonas] = useState<PersonaPublic[]>([]);
  const [demoDolls, setDemoDolls] = useState<DollSummary[]>([]);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.initSession();
        const [pList, dList] = await Promise.all([api.listPersonas(), api.listDolls()]);
        if (!active) return;
        setPersonas(pList);
        setDemoDolls(dList.filter((d) => d.kind === 'demo'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const demoDollByPersonaId = useMemo(() => {
    const map = new Map<string, DollSummary>();
    for (const d of demoDolls) {
      map.set(d.persona.id, d);
    }
    return map;
  }, [demoDolls]);

  const filtered = useMemo(() => {
    if (groupFilter === 'ALL') return personas;
    return personas.filter((p) => p.mbtiGroup === groupFilter);
  }, [personas, groupFilter]);

  const activeGroupInfo = GROUP_META.find((g) => g.key === groupFilter) ?? GROUP_META[0];

  return (
    <div className="max-w-[1160px] mx-auto px-3.5 sm:px-8 py-4 sm:py-7 space-y-5">
      {/* Museum Header + 4-Group Segmented Filter */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E8DFD2] pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-atelier-num italic tracking-[0.08em] text-[#8E7C6E]">
            <span>Botanical Persona Index · 16 Types</span>
          </div>
          <h1 className="font-editorial text-2xl sm:text-[28px] font-semibold tracking-tight text-[#382A22]">
            16 型果壳人格图鉴
          </h1>
          <p className="text-xs sm:text-[13px] text-[#6E5C50]">
            {activeGroupInfo.subtitle} · 任选一种人格直接定制专属果壳形象，或先与展位常驻角色试聊。
          </p>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {GROUP_META.map((g) => {
            const active = groupFilter === g.key;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => {
                  haptic('selection');
                  setGroupFilter(g.key);
                }}
                className={`relative px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#382A22] text-[#FAF7F2] shadow-sm'
                    : 'bg-[#FFFDF9] border border-[#E5DACB] text-[#6E5C50] hover:border-[#C9B9A6] hover:text-[#382A22]'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </header>

      {loading ? (
        <WatercolorPersonaGridSkeleton count={8} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
          {filtered.map((persona, index) => {
            const demoDoll = demoDollByPersonaId.get(persona.id);
            const groupKey = persona.mbtiGroup || 'NF';
            const badgeClass = GROUP_BADGE_STYLE[groupKey] || GROUP_BADGE_STYLE.NF;

            return (
              <motion.article
                key={persona.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(index * 0.025, 0.25), ease: EASE_STUDIO }}
                className="studio-card rounded-[20px] p-4 flex flex-col justify-between gap-3.5 hover:border-[#CFC1AE] transition-colors"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold ${badgeClass}`}
                    >
                      {persona.mbti}
                    </span>
                    <span className="text-[10.5px] font-mono text-[#9A887B] truncate">
                      {persona.cognitiveAxis || groupKey}
                    </span>
                  </div>

                  <div>
                    <h2 className="font-editorial text-[17px] font-semibold text-[#382A22]">
                      {persona.name}
                    </h2>
                    <p className="text-xs text-[#6E5C50] mt-1 leading-relaxed">{persona.tagline}</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#FAF6F0]/90 border border-[#EFE6D8] space-y-1">
                    <div className="text-[10.5px] font-medium text-[#4A8276]">推荐手作材质</div>
                    <p className="text-[11.5px] text-[#5B4B41] leading-snug">{persona.materialHint}</p>
                  </div>

                  <blockquote className="atelier-pullquote px-3 py-2 text-[11.5px] text-[#5B4B41] leading-relaxed line-clamp-3">
                    “{persona.openingLine}”
                  </blockquote>
                </div>

                <div className="pt-2.5 border-t border-[#F0E8DC] flex items-center justify-between gap-2">
                  <Link
                    to={`/create?personaId=${encodeURIComponent(persona.id)}`}
                    onClick={() => haptic('light')}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium btn-ink-tinted whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#4A8276]" />
                    <span>以此定制</span>
                  </Link>

                  {demoDoll ? (
                    <Link
                      to={`/d/${demoDoll.id}/chat`}
                      onClick={() => haptic('selection')}
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium btn-paper-soft whitespace-nowrap"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[#4A8276]" />
                      <span>试聊</span>
                    </Link>
                  ) : (
                    <Link
                      to={`/create?personaId=${encodeURIComponent(persona.id)}`}
                      onClick={() => haptic('selection')}
                      aria-label={`进入 ${persona.name} 定制`}
                      className="p-2 text-[#8E7C6E] hover:text-[#4A8276] transition-colors"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </Link>
                  )}
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </div>
  );
}
