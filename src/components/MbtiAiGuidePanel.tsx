import { useEffect, useState } from 'react';
import {
  Check,
  Compass,
  RefreshCw,
  Send,
  Sparkles,
  Target,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  CognitiveFunction,
  CognitiveFunctionScores,
  MbtiGuideHistoryItem,
  MbtiGuideOption,
  MbtiGuideReport,
  MbtiGuideTurnResponse,
} from '../lib/types';
import { haptic } from '../lib/haptics';

const FUNCTION_ORDER: CognitiveFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

const FUNCTION_SHORT: Record<CognitiveFunction, string> = {
  Ni: '洞察主线',
  Ne: '发散联想',
  Si: '经验锚定',
  Se: '临场感知',
  Ti: '内在逻辑',
  Te: '效率统筹',
  Fi: '价值本心',
  Fe: '共鸣氛围',
};

interface MbtiAiGuidePanelProps {
  onApplyPersona: (personaIdOrMbti: string, suggestedMaterialIds?: string[]) => void;
  onResultReady?: (report: MbtiGuideReport) => void;
}

export function MbtiAiGuidePanel({ onApplyPersona, onResultReady }: MbtiAiGuidePanelProps) {
  const [history, setHistory] = useState<MbtiGuideHistoryItem[]>([]);
  const [rawScores, setRawScores] = useState<Partial<CognitiveFunctionScores> | undefined>(undefined);
  const [maxRounds, setMaxRounds] = useState<number>(5);
  const [turnData, setTurnData] = useState<MbtiGuideTurnResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const [selectedAppliedMbti, setSelectedAppliedMbti] = useState<string | null>(null);

  const runTurn = async (params: {
    nextHistory: MbtiGuideHistoryItem[];
    nextScores?: Partial<CognitiveFunctionScores>;
    nextMaxRounds?: number;
    forceConclude?: boolean;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.mbtiGuideTurn({
        history: params.nextHistory,
        rawScores: params.nextScores,
        maxRounds: params.nextMaxRounds ?? maxRounds,
        forceConclude: params.forceConclude,
      });
      setTurnData(res);
      setRawScores(res.rawScores);
      if (res.status === 'completed' && res.report) {
        haptic('success');
        setSelectedAppliedMbti(res.report.primaryMbti);
        onApplyPersona(res.report.primaryPersonaId, res.report.suggestedMaterialIds);
        onResultReady?.(res.report);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 人格引导加载失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runTurn({ nextHistory: [], nextMaxRounds: 5 });
  }, []);

  const handleSelectOption = async (opt: MbtiGuideOption) => {
    if (loading || !turnData?.nextQuestion) return;
    haptic('selection');
    const q = turnData.nextQuestion;
    const nextHistory: MbtiGuideHistoryItem[] = [
      ...history,
      {
        questionId: q.id,
        questionPrompt: q.prompt,
        userAnswer: opt.label,
        selectedOptionId: opt.id,
        optionWeights: opt.weights,
      },
    ];
    setHistory(nextHistory);
    setFreeText('');
    await runTurn({ nextHistory, nextScores: rawScores });
  };

  const handleSubmitFreeText = async () => {
    const trimmed = freeText.trim();
    if (!trimmed || loading || !turnData?.nextQuestion) return;
    haptic('medium');
    const q = turnData.nextQuestion;
    const nextHistory: MbtiGuideHistoryItem[] = [
      ...history,
      {
        questionId: q.id,
        questionPrompt: q.prompt,
        userAnswer: trimmed,
      },
    ];
    setHistory(nextHistory);
    setFreeText('');
    await runTurn({ nextHistory, nextScores: rawScores });
  };

  const handleCalibrateMore = async () => {
    if (loading) return;
    haptic('medium');
    const bumpedMax = Math.min(8, Math.max(maxRounds, history.length) + 2);
    setMaxRounds(bumpedMax);
    await runTurn({
      nextHistory: history,
      nextScores: rawScores,
      nextMaxRounds: bumpedMax,
      forceConclude: false,
    });
  };

  const handleRestart = async () => {
    if (loading) return;
    haptic('light');
    setHistory([]);
    setRawScores(undefined);
    setMaxRounds(5);
    setSelectedAppliedMbti(null);
    setFreeText('');
    await runTurn({ nextHistory: [], nextScores: undefined, nextMaxRounds: 5 });
  };

  const progressPct = turnData
    ? turnData.status === 'completed'
      ? 100
      : Math.min(95, Math.round(((turnData.round - 1) / turnData.maxRounds) * 100))
    : 8;

  // Initial loading state
  if (!turnData && loading) {
    return (
      <div className="rounded-2xl border border-[#E6DDD0] bg-[#FAF7F1] p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#3D7267]">
          <Sparkles className="w-4 h-4 animate-pulse" />
          <span>AI 荣格八维人格引导师正在准备第 1 轮情景访谈…</span>
        </div>
        <div className="h-2.5 w-3/4 rounded-full bg-[#EAE2D6] animate-pulse" />
        <div className="h-10 w-full rounded-xl bg-[#EFE8DC] animate-pulse" />
        <div className="h-10 w-full rounded-xl bg-[#EFE8DC] animate-pulse" />
      </div>
    );
  }

  if (error && !turnData) {
    return (
      <div className="rounded-2xl border border-[#E5B8B0] bg-[#FDF2F0] p-4 space-y-2.5 text-xs text-[#9E3D2E]">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void handleRestart()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E5B8B0] font-medium"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>重新启动 AI 引导</span>
        </button>
      </div>
    );
  }

  // Completed Psychometric Report View
  if (turnData?.status === 'completed' && turnData.report) {
    const report = turnData.report;
    const dominantSet = new Set(report.dominantStack.slice(0, 2));
    const axisRows = [
      { left: '外倾 E', right: '内倾 I', leftPct: report.axisPercentages.E },
      { left: '直觉 N', right: '实感 S', leftPct: report.axisPercentages.N },
      { left: '情感 F', right: '思考 T', leftPct: report.axisPercentages.F },
      { left: '感知 P', right: '判断 J', leftPct: report.axisPercentages.P },
    ];

    return (
      <div className="rounded-2xl border border-[#C6E1D9] bg-[#FAFDFB] p-4 sm:p-5 space-y-4">
        {/* Header Summary */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E3EFEA] pb-3.5">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-lg bg-[#2F6A5E] text-white font-mono text-sm font-bold tracking-wider">
                {report.primaryMbti}
              </span>
              <span className="font-editorial text-base font-semibold text-[#382A22]">
                {report.personaName}
              </span>
              <span className="text-[11px] font-mono text-[#3D7267] bg-[#E8F4F0] px-2 py-0.5 rounded-md">
                收敛置信度 {report.confidence}%
              </span>
            </div>
            <p className="text-xs text-[#5E6E68] font-medium">{report.stackSummary}</p>
          </div>

          <div className="flex items-center gap-2">
            {history.length < 8 && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleCalibrateMore()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-medium btn-ink-tinted whitespace-nowrap"
              >
                <Target className="w-3.5 h-3.5 text-[#4A8276]" />
                <span>{loading ? '生成追问…' : '再追问 2 题精校'}</span>
              </button>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleRestart()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-medium btn-paper-soft whitespace-nowrap"
            >
              <RefreshCw className="w-3 h-3" />
              <span>重测</span>
            </button>
          </div>
        </div>

        {/* Evidence + Top-1 vs Top-2 Disambiguation */}
        <div className="space-y-2 text-xs leading-relaxed text-[#4E4036]">
          <p>{report.evidenceSummary}</p>
          <div className="p-2.5 rounded-xl bg-[#F4F9F7] border border-[#DCECE6] text-[11.5px] text-[#355E54]">
            <strong className="font-semibold">鉴别依据：</strong>
            {report.disambiguationNote}
          </div>
        </div>

        {/* 4-Axis Balance Bars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          {axisRows.map((row) => {
            const rightPct = 100 - row.leftPct;
            const leftWins = row.leftPct >= 50;
            return (
              <div
                key={row.left}
                className="p-2.5 rounded-xl bg-white border border-[#E7EFEA] space-y-1.5"
              >
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className={leftWins ? 'font-semibold text-[#2E6458]' : 'text-[#8E7C6E]'}>
                    {row.left} {row.leftPct}%
                  </span>
                  <span className={!leftWins ? 'font-semibold text-[#2E6458]' : 'text-[#8E7C6E]'}>
                    {rightPct}% {row.right}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[#EAE3D8] overflow-hidden flex">
                  <div
                    className={`h-full transition-all duration-300 ${
                      leftWins ? 'bg-[#4A8276]' : 'bg-[#C7BFB2]'
                    }`}
                    style={{ width: `${row.leftPct}%` }}
                  />
                  <div
                    className={`h-full transition-all duration-300 ${
                      !leftWins ? 'bg-[#4A8276]' : 'bg-[#C7BFB2]'
                    }`}
                    style={{ width: `${rightPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Jungian 8 Cognitive Functions Mini Grid */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[#7D6C5F]">
            <span className="font-medium">荣格八维认知功能图谱</span>
            <span className="font-mono text-[#4A8276]">
              功能栈：{report.dominantStack.join(' → ')}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {FUNCTION_ORDER.map((fn) => {
              const val = report.functionScores[fn] ?? 50;
              const isDom = dominantSet.has(fn);
              return (
                <div
                  key={fn}
                  className={`p-2 rounded-xl border text-center space-y-1 ${
                    isDom
                      ? 'border-[#4A8276]/55 bg-[#EEF7F4]'
                      : 'border-[#EAE2D6] bg-white/80'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10.5px] font-mono">
                    <span className={isDom ? 'font-bold text-[#2D6458]' : 'text-[#6E5C50]'}>
                      {fn}
                    </span>
                    <span className="text-[#8E7C6E]">{val}</span>
                  </div>
                  <div className="h-1 rounded-full bg-[#ECE5D9] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isDom ? 'bg-[#4A8276]' : 'bg-[#C6B8A6]'}`}
                      style={{ width: `${val}%` }}
                    />
                  </div>
                  <div className="text-[9.5px] text-[#8E7C6E] truncate">{FUNCTION_SHORT[fn]}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Alternate Candidates Switcher */}
        <div className="pt-2 border-t border-[#E3EFEA] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#6E5C50]">
            <span>已自动选定：</span>
            <button
              type="button"
              onClick={() => {
                setSelectedAppliedMbti(report.primaryMbti);
                onApplyPersona(report.primaryPersonaId, report.suggestedMaterialIds);
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono font-semibold border ${
                selectedAppliedMbti === report.primaryMbti
                  ? 'border-[#4A8276] bg-[#E8F4F0] text-[#285B50]'
                  : 'border-[#DDD3C5] bg-white text-[#6E5C50]'
              }`}
            >
              {selectedAppliedMbti === report.primaryMbti && <Check className="w-3 h-3" />}
              <span>{report.primaryMbti}</span>
            </button>
            {report.alternateMbtis.length > 0 && (
              <>
                <span className="text-[#9A887B] ml-1">相近备选：</span>
                {report.alternateMbtis.map((alt) => (
                  <button
                    key={alt.mbti}
                    type="button"
                    onClick={() => {
                      setSelectedAppliedMbti(alt.mbti);
                      onApplyPersona(alt.mbti);
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono border transition-colors ${
                      selectedAppliedMbti === alt.mbti
                        ? 'border-[#4A8276] bg-[#E8F4F0] text-[#285B50] font-semibold'
                        : 'border-[#E6DDD0] bg-white text-[#6E5C50] hover:border-[#4A8276]/50'
                    }`}
                  >
                    <span>
                      {alt.mbti} ({alt.probability}%)
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active Adaptive Interview Round View
  const q = turnData?.nextQuestion;
  const top2Hint =
    turnData && history.length >= 2 && turnData.topCandidates.length >= 2
      ? `正在聚焦鉴别 ${turnData.topCandidates[0].mbti} vs ${turnData.topCandidates[1].mbti}`
      : '荣格八维盲测 · 无标签情景访谈';

  return (
    <div className="rounded-2xl border border-[#E4DBCE] bg-[#FAF7F1] p-4 sm:p-5 space-y-3.5">
      {/* Progress & Adaptive Status Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2E6257]">
            <Compass className="w-4 h-4 text-[#4A8276]" />
            <span>
              AI 深度人格引导 · 第 {turnData?.round ?? 1} / {turnData?.maxRounds ?? maxRounds} 轮
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-mono text-[#4A8276] bg-[#EBF5F1] px-2 py-0.5 rounded-md">
              {q?.phaseLabel || '认知探测'}
            </span>
            {history.length >= 1 && (
              <span className="font-mono text-[#7D6C5F]">
                置信度 {turnData?.confidence ?? 25}%
              </span>
            )}
          </div>
        </div>

        <div className="h-1.5 rounded-full bg-[#EAE2D6] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#4A8276] transition-all duration-300"
            style={{ width: `${Math.max(12, progressPct)}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8E7C6E]">
          <span>{top2Hint}</span>
          {history.length >= 3 && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void runTurn({ nextHistory: history, nextScores: rawScores, forceConclude: true })}
              className="text-[#4A8276] font-medium hover:underline"
            >
              提前查看当前结果
            </button>
          )}
        </div>
      </div>

      {/* AI Reaction to Previous Answer */}
      {q?.reaction && (
        <div className="px-3 py-2 rounded-xl bg-[#EEF6F3] border border-[#CFE5DD] text-[12px] text-[#2F5E53] leading-relaxed">
          {q.reaction}
        </div>
      )}

      {/* Current Scenario Question */}
      {q && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-2xl bg-white border border-[#E7DEC9] shadow-[0_2px_10px_-6px_rgba(56,42,34,0.08)]">
            <p className="font-editorial text-[14px] sm:text-[15px] font-semibold text-[#382A22] leading-relaxed">
              {q.prompt}
            </p>
          </div>

          {/* 4 Unbiased Natural Choice Cards */}
          <div className="space-y-2">
            {q.options.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                disabled={loading}
                data-pressable="card"
                onClick={() => void handleSelectOption(opt)}
                className="w-full text-left px-3.5 py-2.5 rounded-xl border border-[#E6DDD0] bg-[#FFFDF9] hover:border-[#4A8276] hover:bg-[#F3FAF7] active:scale-[0.99] transition-all flex items-start gap-2.5 disabled:opacity-55"
              >
                <span className="shrink-0 w-5 h-5 rounded-md bg-[#F2ECE2] text-[#5E4E42] font-mono text-[11px] font-semibold flex items-center justify-center mt-0.5">
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="text-[12.5px] sm:text-[13px] text-[#382A22] leading-snug">
                  {opt.label}
                </span>
              </button>
            ))}
          </div>

          {/* Free-text natural answer input (PsyDI-style open response for maximum accuracy!) */}
          <div className="pt-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={freeText}
                disabled={loading}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSubmitFreeText();
                  }
                }}
                placeholder="选项不够贴切？直接用自己的话写下真实想法（准确度更高）…"
                className="flex-1 min-w-0 px-3 py-2 text-[14px] sm:text-xs bg-white border border-[#E4DBCE] rounded-xl focus:outline-none focus:border-[#4A8276]"
              />
              <button
                type="button"
                disabled={loading || !freeText.trim()}
                onClick={() => void handleSubmitFreeText()}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-xs font-medium btn-ink-tinted disabled:opacity-45"
              >
                <Send className="w-3.5 h-3.5 text-[#4A8276]" />
                <span>回答</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-[#4A8276]">
          <Sparkles className="w-3.5 h-3.5 animate-spin" />
          <span>正在解析荣格八维认知信号并生成下一轮精准追问…</span>
        </div>
      )}

      {error && (
        <p className="text-xs text-[#9E3D2E] bg-[#FDF2F0] border border-[#E5B8B0] rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
