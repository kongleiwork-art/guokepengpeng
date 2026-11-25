import { isChatCloudConfigured } from '../config.ts';
import { requestStepFunJson } from './stepfun.ts';
import { PERSONA_SEEDS } from '../data/seed.ts';
import type { MaterialRecord } from '../db.ts';

export type CognitiveFunction = 'Ni' | 'Ne' | 'Si' | 'Se' | 'Ti' | 'Te' | 'Fi' | 'Fe';

export type CognitiveFunctionScores = Record<CognitiveFunction, number>;

export interface MbtiAxisPercentages {
  E: number; // 0..100, I = 100 - E
  N: number; // 0..100, S = 100 - N
  F: number; // 0..100, T = 100 - F
  P: number; // 0..100, J = 100 - P
}

export interface MbtiGuideOption {
  id: string;
  label: string;
  weights: Partial<CognitiveFunctionScores>;
}

export interface MbtiGuideQuestion {
  id: string;
  round: number;
  phaseLabel: string;
  targetAxes: string;
  reaction?: string;
  prompt: string;
  options: MbtiGuideOption[];
}

export interface MbtiGuideHistoryItem {
  questionId: string;
  questionPrompt: string;
  userAnswer: string;
  selectedOptionId?: string;
  optionWeights?: Partial<CognitiveFunctionScores>;
}

export interface MbtiGuideReport {
  primaryMbti: string;
  primaryPersonaId: string;
  personaName: string;
  confidence: number; // 0..99
  dominantStack: [CognitiveFunction, CognitiveFunction, CognitiveFunction, CognitiveFunction];
  stackSummary: string;
  functionScores: CognitiveFunctionScores; // normalized 0..100
  axisPercentages: MbtiAxisPercentages;
  alternateMbtis: Array<{ mbti: string; probability: number; personaName: string }>;
  keywords: string[];
  evidenceSummary: string;
  disambiguationNote: string;
  suggestedMaterialIds: string[];
}

export interface MbtiGuideTurnInput {
  history: MbtiGuideHistoryItem[];
  rawScores?: Partial<CognitiveFunctionScores>;
  maxRounds?: number;
  forceConclude?: boolean;
  providerMode: 'mock' | 'cloud';
  inStockMaterials: MaterialRecord[];
}

export interface MbtiGuideTurnOutput {
  status: 'questioning' | 'completed';
  engine: 'stepfun_adaptive' | 'cat_local';
  round: number;
  maxRounds: number;
  confidence: number;
  topCandidates: Array<{ mbti: string; probability: number }>;
  rawScores: CognitiveFunctionScores;
  normalizedScores: CognitiveFunctionScores;
  axisPercentages: MbtiAxisPercentages;
  nextQuestion?: MbtiGuideQuestion;
  report?: MbtiGuideReport;
}

export const ALL_FUNCTIONS: CognitiveFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

export const FUNCTION_LABELS: Record<CognitiveFunction, string> = {
  Ni: 'Ni 内倾直觉（洞察主线）',
  Ne: 'Ne 外倾直觉（发散联想）',
  Si: 'Si 内倾感觉（经验锚定）',
  Se: 'Se 外倾感觉（即时感知）',
  Ti: 'Ti 内倾思考（内在逻辑）',
  Te: 'Te 外倾思考（效率统筹）',
  Fi: 'Fi 内倾情感（价值本心）',
  Fe: 'Fe 外倾情感（共鸣氛围）',
};

/**
 * Canonical Grant-Brownsword 4-function cognitive stacks for all 16 MBTI types.
 * Used for both mathematical CAT scoring and grounding LLM evaluation so we avoid
 * naive 4-letter stereotyping (e.g., INFP Fi-Ne-Si-Te vs INFJ Ni-Fe-Ti-Se).
 */
export const MBTI_FUNCTION_STACKS: Record<
  string,
  [CognitiveFunction, CognitiveFunction, CognitiveFunction, CognitiveFunction]
> = {
  INTJ: ['Ni', 'Te', 'Fi', 'Se'],
  INTP: ['Ti', 'Ne', 'Si', 'Fe'],
  ENTJ: ['Te', 'Ni', 'Se', 'Fi'],
  ENTP: ['Ne', 'Ti', 'Fe', 'Si'],
  INFJ: ['Ni', 'Fe', 'Ti', 'Se'],
  INFP: ['Fi', 'Ne', 'Si', 'Te'],
  ENFJ: ['Fe', 'Ni', 'Se', 'Ti'],
  ENFP: ['Ne', 'Fi', 'Te', 'Si'],
  ISTJ: ['Si', 'Te', 'Fi', 'Ne'],
  ISFJ: ['Si', 'Fe', 'Ti', 'Ne'],
  ESTJ: ['Te', 'Si', 'Ne', 'Fi'],
  ESFJ: ['Fe', 'Si', 'Ne', 'Ti'],
  ISTP: ['Ti', 'Se', 'Ni', 'Fe'],
  ISFP: ['Fi', 'Se', 'Ni', 'Te'],
  ESTP: ['Se', 'Ti', 'Fe', 'Ni'],
  ESFP: ['Se', 'Fi', 'Te', 'Ni'],
};

const OPPOSITE_ATTITUDE: Record<CognitiveFunction, CognitiveFunction> = {
  Ni: 'Ne',
  Ne: 'Ni',
  Si: 'Se',
  Se: 'Si',
  Ti: 'Te',
  Te: 'Ti',
  Fi: 'Fe',
  Fe: 'Fi',
};

export function createZeroScores(): CognitiveFunctionScores {
  return { Ni: 0, Ne: 0, Si: 0, Se: 0, Ti: 0, Te: 0, Fi: 0, Fe: 0 };
}

export function sanitizeScores(partial?: Partial<CognitiveFunctionScores>): CognitiveFunctionScores {
  const out = createZeroScores();
  if (!partial) return out;
  for (const fn of ALL_FUNCTIONS) {
    const v = Number(partial[fn]);
    out[fn] = Number.isFinite(v) ? Math.max(-30, Math.min(30, v)) : 0;
  }
  return out;
}

export function addWeights(
  base: CognitiveFunctionScores,
  delta?: Partial<CognitiveFunctionScores>,
  scale = 1
): CognitiveFunctionScores {
  const next = { ...base };
  if (!delta) return next;
  for (const fn of ALL_FUNCTIONS) {
    const v = Number(delta[fn]);
    if (Number.isFinite(v)) {
      next[fn] = Number((next[fn] + v * scale).toFixed(3));
    }
  }
  return next;
}

/**
 * Normalize raw function scores into intuitive 0..100 bars for UI visualization.
 */
export function normalizeFunctionScores(raw: CognitiveFunctionScores): CognitiveFunctionScores {
  const vals = ALL_FUNCTIONS.map((f) => raw[f]);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const span = Math.max(max - min, 2.5);
  const out = createZeroScores();
  for (const fn of ALL_FUNCTIONS) {
    const scaled = ((raw[fn] - min) / span) * 78 + 18;
    out[fn] = Math.round(Math.max(12, Math.min(98, scaled)));
  }
  return out;
}

/**
 * Compute full 16-type Bayesian/Softmax posterior distribution from Jungian 8-function vector.
 * Weights reflect Grant stack salience: Dom(1.0), Aux(0.72), Tert(0.28), Inf(-0.22),
 * plus slight penalty if the opposing shadow dominant dominates strongly.
 */
export function computeMbtiPosterior(raw: CognitiveFunctionScores): {
  ranked: Array<{ mbti: string; probability: number; rawFit: number }>;
  confidence: number;
  axisPercentages: MbtiAxisPercentages;
} {
  const entries = Object.entries(MBTI_FUNCTION_STACKS).map(([mbti, stack]) => {
    const [dom, aux, tert, inf] = stack;
    const shadowDom = OPPOSITE_ATTITUDE[dom];
    const shadowAux = OPPOSITE_ATTITUDE[aux];

    // Extraverted vs introverted dominant energy bonus
    const isExtrovert = mbti[0] === 'E';
    const extrovertSignal =
      raw.Ne + raw.Se + raw.Te + raw.Fe - (raw.Ni + raw.Si + raw.Ti + raw.Fi);

    const rawFit =
      raw[dom] * 1.05 +
      raw[aux] * 0.78 +
      raw[tert] * 0.25 -
      raw[inf] * 0.32 -
      raw[shadowDom] * 0.14 -
      raw[shadowAux] * 0.1 +
      (isExtrovert ? extrovertSignal * 0.14 : -extrovertSignal * 0.14);

    return { mbti, rawFit };
  });

  // Temperature-calibrated softmax
  const temperature = 1.65;
  const maxFit = Math.max(...entries.map((e) => e.rawFit));
  const exps = entries.map((e) => ({
    ...e,
    exp: Math.exp((e.rawFit - maxFit) / temperature),
  }));
  const sumExp = exps.reduce((acc, e) => acc + e.exp, 0) || 1;

  const ranked = exps
    .map((e) => ({
      mbti: e.mbti,
      rawFit: Number(e.rawFit.toFixed(3)),
      probability: e.exp / sumExp,
    }))
    .sort((a, b) => b.probability - a.probability);

  // Derive 4-axis continuous percentages directly from the 16-type posterior
  let eProb = 0;
  let nProb = 0;
  let fProb = 0;
  let pProb = 0;
  for (const item of ranked) {
    if (item.mbti[0] === 'E') eProb += item.probability;
    if (item.mbti[1] === 'N') nProb += item.probability;
    if (item.mbti[2] === 'F') fProb += item.probability;
    if (item.mbti[3] === 'P') pProb += item.probability;
  }

  const clampPct = (v: number) => Math.round(Math.max(6, Math.min(94, v * 100)));
  const axisPercentages: MbtiAxisPercentages = {
    E: clampPct(eProb),
    N: clampPct(nProb),
    F: clampPct(fProb),
    P: clampPct(pProb),
  };

  // Confidence combines top-1 posterior + separation margin over #2
  const top1 = ranked[0]?.probability ?? 0.0625;
  const top2 = ranked[1]?.probability ?? 0.0625;
  const margin = Math.max(0, top1 - top2);
  const confidence = Math.round(Math.min(97, Math.max(12, top1 * 100 + margin * 38)));

  return { ranked, confidence, axisPercentages };
}

/**
 * Lightweight Chinese cognitive syntax cue analyzer for free-text responses.
 * Captures reasoning mechanics (causal structure vs empathy vs sensory detail vs divergence)
 * when running in local CAT mode or as a stabilizing prior alongside StepFun.
 */
export function extractChineseCognitiveCues(text: string): Partial<CognitiveFunctionScores> {
  const clean = text.trim();
  if (!clean) return {};
  const delta: Partial<CognitiveFunctionScores> = {};
  const bump = (fn: CognitiveFunction, val: number) => {
    delta[fn] = (delta[fn] ?? 0) + val;
  };

  const rules: Array<{ re: RegExp; weights: Partial<CognitiveFunctionScores> }> = [
    { re: /(底层逻辑|原理|自洽|推导|拆解|概念|定义|本质矛盾|框架|为什么会这样)/, weights: { Ti: 1.3, Ni: 0.4 } },
    { re: /(效率|目标|结果|指标|时间表|排期|分工|推进|落地|性价比|步骤|清单|deadline)/i, weights: { Te: 1.3, Si: 0.3 } },
    { re: /(本质|趋势|长远|预感|终局|主线|看穿|一眼看出|宿命|深层含义|方向感)/, weights: { Ni: 1.35, Ti: 0.3 } },
    { re: /(脑洞|可能性|联想|万一|跨界|好玩|新鲜点子|突然想到|顺便|灵感|无数种)/, weights: { Ne: 1.35, Fi: 0.25 } },
    { re: /(真心|原则|底线|真诚|不违背自己|内在感受|真实|共鸣|自我|意义|美学|情绪质地)/, weights: { Fi: 1.35, Ne: 0.25 } },
    { re: /(大家|氛围|照顾|体谅|情绪价值|关系|和谐|人情|顾及别人|让每个人舒服|陪伴)/, weights: { Fe: 1.35, Si: 0.25 } },
    { re: /(习惯|以前|经验|稳妥|细节|记得|靠谱|熟悉|复盘|照旧|踏实|安全感)/, weights: { Si: 1.3, Te: 0.25 } },
    { re: /(当下|马上动手|直接试|现场|手感|刺激|立刻|风景|感官|体验|先干再说|行动)/, weights: { Se: 1.35, Ti: 0.25 } },
    { re: /(独处|安静|一个人|自己消化|消耗能量|社恐|留白)/, weights: { Ni: 0.45, Fi: 0.45, Ti: 0.45, Si: 0.45 } },
    { re: /(聊天|热闹|一起|互动|讨论|分享|表达出来)/, weights: { Ne: 0.45, Fe: 0.45, Te: 0.45, Se: 0.45 } },
  ];

  for (const r of rules) {
    if (r.re.test(clean)) {
      for (const [fn, w] of Object.entries(r.weights) as Array<[CognitiveFunction, number]>) {
        bump(fn, w);
      }
    }
  }
  return delta;
}

/**
 * Curated 16-item Psychometric Blind Scenario Bank (inspired by PsyDI / Jungian Cognitive Tests).
 * Every item avoids naive stereotypes ("extrovert vs introvert") and probes actual cognitive
 * mechanisms + pair-specific disambiguation (e.g., INFP vs INFJ, INTJ vs INTP, ENFP vs ENTP).
 */
interface CuratedScenario {
  id: string;
  phaseLabel: string;
  targetAxes: string;
  /** Which functions this item primarily differentiates (used by CAT info-gain selector) */
  probeFunctions: CognitiveFunction[];
  /** Optional pair specialization for high-precision disambiguation */
  disambiguates?: string[];
  prompt: string;
  options: MbtiGuideOption[];
}

const CURATED_SCENARIOS: CuratedScenario[] = [
  {
    id: 'cat_perceiving_entry',
    phaseLabel: '感知方式探测',
    targetAxes: 'Ni / Ne / Si / Se',
    probeFunctions: ['Ni', 'Ne', 'Si', 'Se'],
    prompt: '走进一家你从未去过的手作杂货店，满屋都是风干果实、旧木柜与手写卡片。你最初 10 秒的注意力最常停在哪里？',
    options: [
      {
        id: 'opt_se',
        label: '直接伸手摸摸果壳与布料的质感，被当下的光影、气味和颜色瞬间抓住',
        weights: { Se: 2.0, Fi: 0.4, Ti: 0.3 },
      },
      {
        id: 'opt_ne',
        label: '脑海里立刻冒出三四个跨界点子：“如果把这个挂在耳机壳/风铃上会怎样？”',
        weights: { Ne: 2.0, Ti: 0.3, Fi: 0.3 },
      },
      {
        id: 'opt_ni',
        label: '很快捕捉到整间店的隐形主题与店主审美脉络，好奇背后的核心理念',
        weights: { Ni: 2.0, Te: 0.3, Fe: 0.3 },
      },
      {
        id: 'opt_si',
        label: '留意陈列是否工整、做工针脚是否扎实，顺便和以前逛过的好店做对照',
        weights: { Si: 2.0, Te: 0.35, Fe: 0.25 },
      },
    ],
  },
  {
    id: 'cat_judging_dilemma',
    phaseLabel: '决策核心探测',
    targetAxes: 'Ti / Te / Fi / Fe',
    probeFunctions: ['Ti', 'Te', 'Fi', 'Fe'],
    prompt: '小组筹备一次周末市集摊位，临近开摆前大家在“作品风格”和“回本效率”上吵了起来。你内心最先冒出的本能反应是？',
    options: [
      {
        id: 'opt_te',
        label: '先把核心目标、预算和时间节点列在白板上，定出可执行的最优方案',
        weights: { Te: 2.1, Ni: 0.3, Si: 0.3 },
      },
      {
        id: 'opt_ti',
        label: '先静音观察：双方争论的前提其实不在同一逻辑层，得把核心矛盾拆清',
        weights: { Ti: 2.1, Ne: 0.3, Se: 0.25 },
      },
      {
        id: 'opt_fe',
        label: '先安抚大家紧绷的情绪，找出能让每个人都不委屈、关系不伤和气的折中点',
        weights: { Fe: 2.1, Ni: 0.25, Si: 0.3 },
      },
      {
        id: 'opt_fi',
        label: '默默评估哪种方案不违背自己真正认同的美学和底线，不愿为凑合而失去灵魂',
        weights: { Fi: 2.1, Ne: 0.3, Se: 0.25 },
      },
    ],
  },
  {
    id: 'cat_energy_processing',
    phaseLabel: '能量流向与思维节奏',
    targetAxes: '外倾加工 vs 内倾加工',
    probeFunctions: ['Ne', 'Fe', 'Te', 'Se', 'Ni', 'Fi', 'Ti', 'Si'],
    prompt: '遇到一件让你心里很在意、一时理不清头绪的烦心事，哪种处理方式最能让你真正松一口气？',
    options: [
      {
        id: 'opt_e_talk',
        label: '边跟信任的朋友吐槽边碰撞灵感，往往话讲到一半自己就想通了',
        weights: { Ne: 1.1, Fe: 1.1, Se: 0.6, Te: 0.5 },
      },
      {
        id: 'opt_e_act',
        label: '懒得空想太久，直接列个动作或先去试一小步，在真实反馈里快速调整',
        weights: { Se: 1.2, Te: 1.2, Ne: 0.4 },
      },
      {
        id: 'opt_i_reflect',
        label: '必须先一个人安静消化，把情绪或想法沉淀成形，才愿意拿出来分享',
        weights: { Fi: 1.2, Ni: 1.1, Ti: 0.7, Si: 0.5 },
      },
      {
        id: 'opt_i_archive',
        label: '找个熟悉安静的角落复盘前因后果，按部就班把可控的部分先安排稳妥',
        weights: { Si: 1.2, Ti: 1.0, Ni: 0.6, Fi: 0.4 },
      },
    ],
  },
  {
    id: 'cat_pressure_response',
    phaseLabel: '压力与突发应变',
    targetAxes: '计划收敛 vs 开放应变',
    probeFunctions: ['Te', 'Ni', 'Si', 'Ne', 'Se', 'Ti'],
    prompt: '原本期待很久的周末计划突然因为暴雨全部泡汤，同行的朋友有点泄气。你最真实的应对方式是？',
    options: [
      {
        id: 'opt_ni_te',
        label: '其实出门前就顺手留过 B 方案，迅速切到室内路线并把节奏重新稳住',
        weights: { Ni: 1.2, Te: 1.2, Si: 0.7 },
      },
      {
        id: 'opt_ne_p',
        label: '反而觉得有点惊喜！立刻开始发散：“下雨天是不是更适合去探那家隐藏旧书店？”',
        weights: { Ne: 1.6, Fi: 0.5, Ti: 0.4 },
      },
      {
        id: 'opt_se_p',
        label: '顺势而为，看窗外雨势和附近有什么现成好玩的，踩着水坑即兴换条街逛',
        weights: { Se: 1.6, Ti: 0.45, Fi: 0.45 },
      },
      {
        id: 'opt_fe_si',
        label: '先顾着把雨具和热饮安排好，照顾大家的心情别着凉，再一起挑个稳妥去处',
        weights: { Fe: 1.3, Si: 1.1 },
      },
    ],
  },
  {
    id: 'cat_disambig_fi_fe',
    phaseLabel: '精准鉴别 · 共情机制',
    targetAxes: 'Fi (INFP/ISFP) vs Fe (INFJ/ENFJ/ISFJ)',
    probeFunctions: ['Fi', 'Fe', 'Ni', 'Ne'],
    disambiguates: ['INFP', 'INFJ', 'ISFP', 'ISFJ', 'ENFP', 'ENFJ'],
    prompt: '朋友向你倾诉一个你其实并不赞同的决定，但 Ta 此刻非常脆弱。你内心更贴近哪一种共情方式？',
    options: [
      {
        id: 'opt_fi_core',
        label: '把 Ta 的处境放进自己心里去体会那种痛感，宁可安静陪着也不说违心附和的话',
        weights: { Fi: 2.2, Ne: 0.4, Se: 0.3, Fe: -0.6 },
      },
      {
        id: 'opt_fe_core',
        label: '能像雷达一样瞬间接住 Ta 期待被回应的情绪温度，先顺着氛围安抚，再找柔和时机引导',
        weights: { Fe: 2.2, Ni: 0.45, Si: 0.3, Fi: -0.6 },
      },
      {
        id: 'opt_ni_fe',
        label: '很快隐约看穿 Ta 这个决定背后的长期隐患，既心疼 Ta 又忍不住想帮 Ta 看清长远局势',
        weights: { Ni: 1.6, Fe: 1.3, Te: 0.4 },
      },
      {
        id: 'opt_ti_neutral',
        label: '先保持一点冷静距离，帮 Ta 剥离情绪噪音、还原事实本身，觉得真帮到才是最好的安慰',
        weights: { Ti: 1.8, Te: 0.7, Fe: -0.5 },
      },
    ],
  },
  {
    id: 'cat_disambig_ni_ne',
    phaseLabel: '精准鉴别 · 直觉方向',
    targetAxes: 'Ni (INTJ/INFJ/ENTJ) vs Ne (INTP/INFP/ENFP/ENTP)',
    probeFunctions: ['Ni', 'Ne', 'Ti', 'Te'],
    disambiguates: ['INTJ', 'INTP', 'INFJ', 'INFP', 'ENTJ', 'ENTP', 'ENFJ', 'ENFP'],
    prompt: '当你深度思考一个有趣的话题（比如“未来十年的生活形态”）时，你的大脑运行更像哪种画面？',
    options: [
      {
        id: 'opt_ni_funnel',
        label: '像漏斗收束：把零散线索不断压缩，最终笃定地收束成一条清晰深刻的主线预判',
        weights: { Ni: 2.3, Te: 0.4, Fe: 0.3, Ne: -0.7 },
      },
      {
        id: 'opt_ne_tree',
        label: '像树枝分叉：一个念头炸出五个平行脑洞，享受不断推翻假设、保持开放的爽感',
        weights: { Ne: 2.3, Ti: 0.4, Fi: 0.3, Ni: -0.7 },
      },
      {
        id: 'opt_si_anchor',
        label: '先回到真实经历与可靠数据里找锚点，觉得脱离现实细节的空想意义不大',
        weights: { Si: 1.8, Te: 0.5, Ne: -0.5, Ni: -0.5 },
      },
      {
        id: 'opt_se_anchor',
        label: '与其推演十年后，更在意眼前触手可及的变化——等新事物真出现了直接上手玩',
        weights: { Se: 1.9, Ti: 0.4, Ni: -0.6 },
      },
    ],
  },
  {
    id: 'cat_disambig_ti_te',
    phaseLabel: '精准鉴别 · 思考路径',
    targetAxes: 'Ti (INTP/ISTP/ENTP) vs Te (INTJ/ENTJ/ESTJ/ISTJ)',
    probeFunctions: ['Ti', 'Te', 'Ni', 'Ne'],
    disambiguates: ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'ISTJ', 'ISTP', 'ESTJ', 'ESTP'],
    prompt: '学一项新技能或接手一个复杂任务时，什么会让你最不舒服、最想立刻纠正？',
    options: [
      {
        id: 'opt_ti_pure',
        label: '“大家都这么做”却讲不出底层原理——只要逻辑有一处不自洽，我就浑身难受',
        weights: { Ti: 2.3, Ne: 0.4, Se: 0.3, Te: -0.6 },
      },
      {
        id: 'opt_te_pure',
        label: '反复清谈原理却迟迟没有进度、权责不清或浪费资源——我只想先拿结果再优化',
        weights: { Te: 2.3, Ni: 0.4, Si: 0.4, Ti: -0.5 },
      },
      {
        id: 'opt_fi_pure',
        label: '做这件事让我觉得违心、机械、毫无个人热爱——没有内在认同感我很难提劲',
        weights: { Fi: 2.0, Ne: 0.3, Se: 0.3 },
      },
      {
        id: 'opt_fe_pure',
        label: '团队互相甩锅、气氛冰冷僵硬——我觉得先把人的配合顺畅了，事才能做好',
        weights: { Fe: 2.0, Si: 0.3, Ni: 0.3 },
      },
    ],
  },
  {
    id: 'cat_disambig_si_se',
    phaseLabel: '精准鉴别 · 感官锚点',
    targetAxes: 'Si (ISTJ/ISFJ/ESTJ/ESFJ) vs Se (ISTP/ISFP/ESTP/ESFP)',
    probeFunctions: ['Si', 'Se', 'Fi', 'Te'],
    disambiguates: ['ISTJ', 'ISTP', 'ISFJ', 'ISFP', 'ESTJ', 'ESTP', 'ESFJ', 'ESFP'],
    prompt: '回顾一段让你特别难忘的好时光，留在你脑海里最鲜明的是什么？',
    options: [
      {
        id: 'opt_si_mem',
        label: '熟悉安心的仪式感细节：那天的气温、常去的老店味道，以及“一切都在轨道上”的踏实',
        weights: { Si: 2.2, Fe: 0.4, Te: 0.4, Se: -0.6 },
      },
      {
        id: 'opt_se_mem',
        label: '鲜活饱满的临场冲击：风吹在脸上的速度、现场的鼓点色彩，以及肾上腺素飙升的痛快',
        weights: { Se: 2.2, Ti: 0.35, Fi: 0.4, Si: -0.6 },
      },
      {
        id: 'opt_ni_mem',
        label: '那一刻带给我的顿悟与人生转折意义，具体穿了什么吃了什么反而模糊了',
        weights: { Ni: 1.9, Fi: 0.3, Ti: 0.3, Si: -0.5 },
      },
      {
        id: 'opt_ne_mem',
        label: '那天聊出的奇思妙想与意外插曲，像打开了一个新世界的大门',
        weights: { Ne: 1.9, Fi: 0.35, Ti: 0.35, Si: -0.5 },
      },
    ],
  },
  {
    id: 'cat_disambig_intj_infj',
    phaseLabel: '精准鉴别 · Ni 辅助轴',
    targetAxes: 'Ni-Te vs Ni-Fe',
    probeFunctions: ['Te', 'Fe', 'Ni', 'Fi'],
    disambiguates: ['INTJ', 'INFJ', 'ENTJ', 'ENFJ'],
    prompt: '当你隐约预感到一件事的发展方向不对劲，准备开口提醒别人时，你通常怎么表达？',
    options: [
      {
        id: 'opt_ni_te_cut',
        label: '直接点出关键漏洞和后果，语气温和但结论锋利，觉得拐弯抹角反而耽误事',
        weights: { Te: 2.0, Ni: 1.2, Fe: -0.7 },
      },
      {
        id: 'opt_ni_fe_wrap',
        label: '会先体察对方此刻的承受度，用隐喻或轻柔的提问引导 Ta 自己意识到问题',
        weights: { Fe: 2.0, Ni: 1.2, Te: -0.6 },
      },
      {
        id: 'opt_fi_stay',
        label: '除非对方主动问我，否则尊重每个人自己的人生课题，不想扮演指导者',
        weights: { Fi: 1.8, Ne: 0.6, Se: 0.4, Te: -0.4 },
      },
      {
        id: 'opt_ne_ti_play',
        label: '抛一个反常识的玩笑或极端假设，让对方顺着脑洞自己发现逻辑漏洞',
        weights: { Ne: 1.6, Ti: 1.2 },
      },
    ],
  },
  {
    id: 'cat_disambig_enfp_entp',
    phaseLabel: '精准鉴别 · Ne 辅助轴',
    targetAxes: 'Ne-Fi vs Ne-Ti',
    probeFunctions: ['Fi', 'Ti', 'Ne', 'Fe'],
    disambiguates: ['ENFP', 'ENTP', 'INFP', 'INTP'],
    prompt: '和朋友聊得兴起时，对方提出一个有意思但漏洞百出的观点。你本能会接什么？',
    options: [
      {
        id: 'opt_ne_ti_spar',
        label: '眼睛一亮开始友好抬杠：顺着 Ta 的前提推演到荒诞处，享受思维交锋的乐趣',
        weights: { Ti: 2.1, Ne: 1.2, Fi: -0.6 },
      },
      {
        id: 'opt_ne_fi_spark',
        label: '先被 Ta 观点里真诚动人的部分点亮，再顺着情绪和价值共鸣一起畅想更美的可能',
        weights: { Fi: 2.1, Ne: 1.2, Ti: -0.6 },
      },
      {
        id: 'opt_te_prag',
        label: '拉回现实检验：“想法挺酷，但如果真要落地，第一步成本怎么解决？”',
        weights: { Te: 1.8, Si: 0.6 },
      },
      {
        id: 'opt_se_fun',
        label: '不管逻辑对不对，先起哄哈哈大笑，干脆现在就找个小实验试一把看看',
        weights: { Se: 1.8, Fe: 0.6 },
      },
    ],
  },
];

function selectBestNextLocalScenario(
  usedIds: Set<string>,
  rawScores: CognitiveFunctionScores,
  round: number
): CuratedScenario {
  const remaining = CURATED_SCENARIOS.filter((s) => !usedIds.has(s.id));
  if (remaining.length === 0) return CURATED_SCENARIOS[CURATED_SCENARIOS.length - 1];

  // Round 1 & 2: foundational broadband probes (Perceiving & Judging)
  if (round === 1) {
    return remaining.find((s) => s.id === 'cat_perceiving_entry') ?? remaining[0];
  }
  if (round === 2) {
    return remaining.find((s) => s.id === 'cat_judging_dilemma') ?? remaining[0];
  }
  if (round === 3) {
    return remaining.find((s) => s.id === 'cat_energy_processing') ?? remaining[0];
  }

  // Round 4+: CAT adaptive disambiguation targeting Top-1 vs Top-2 candidates!
  const { ranked } = computeMbtiPosterior(rawScores);
  const top1 = ranked[0]?.mbti ?? 'INFP';
  const top2 = ranked[1]?.mbti ?? 'INFJ';
  const stack1 = MBTI_FUNCTION_STACKS[top1];
  const stack2 = MBTI_FUNCTION_STACKS[top2];

  // Find functions that differ most between top1 and top2
  const diffFuncs = new Set<CognitiveFunction>([stack1[0], stack1[1], stack2[0], stack2[1]]);
  if (stack1[0] === stack2[0]) diffFuncs.delete(stack1[0]);

  let best = remaining[0];
  let bestScore = -1;
  for (const item of remaining) {
    let score = 0;
    if (item.disambiguates?.includes(top1) && item.disambiguates?.includes(top2)) {
      score += 10;
    } else if (item.disambiguates?.includes(top1) || item.disambiguates?.includes(top2)) {
      score += 4;
    }
    for (const fn of item.probeFunctions) {
      if (diffFuncs.has(fn)) score += 2.2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

function buildFinalReport(
  rawScores: CognitiveFunctionScores,
  inStockMaterials: MaterialRecord[],
  customNarrative?: {
    evidenceSummary?: string;
    disambiguationNote?: string;
    keywords?: string[];
  }
): MbtiGuideReport {
  const { ranked, confidence, axisPercentages } = computeMbtiPosterior(rawScores);
  const normalizedScores = normalizeFunctionScores(rawScores);
  const primaryMbti = ranked[0]?.mbti ?? 'INFP';
  const secondaryMbti = ranked[1]?.mbti ?? 'INFJ';

  const persona = PERSONA_SEEDS.find((p) => p.mbti === primaryMbti) ?? PERSONA_SEEDS[0];
  const secondaryPersona = PERSONA_SEEDS.find((p) => p.mbti === secondaryMbti);
  const stack = MBTI_FUNCTION_STACKS[primaryMbti];
  const secStack = MBTI_FUNCTION_STACKS[secondaryMbti];

  const inStockSet = new Set(inStockMaterials.map((m) => m.id));
  const suggestedMaterialIds = persona.recommendedMaterials
    .filter((id) => inStockSet.has(id))
    .slice(0, 4);

  const alternateMbtis = ranked.slice(1, 3).map((item) => {
    const p = PERSONA_SEEDS.find((x) => x.mbti === item.mbti);
    return {
      mbti: item.mbti,
      probability: Math.round(item.probability * 100),
      personaName: p?.name ?? item.mbti,
    };
  });

  const defaultEvidence = `在多轮情景访谈中，你的思考与情绪路径最稳定地落在「${FUNCTION_LABELS[stack[0]]}」与「${FUNCTION_LABELS[stack[1]]}」轴线上，与「${persona.name}（${primaryMbti}）」高度同频。`;
  const defaultDisambiguation = secondaryPersona
    ? `与次高候选 ${secondaryMbti}（${secondaryPersona.name}，${secStack[0]}-${secStack[1]}）相比，你在关键情景里更依赖 ${stack[0]} / ${stack[1]} 作为优先处理机制，因此最终收敛为 ${primaryMbti}。`
    : `你的主导功能 ${stack[0]} 优势明确，人格收敛度较高。`;

  return {
    primaryMbti,
    primaryPersonaId: persona.id,
    personaName: persona.name,
    confidence,
    dominantStack: stack,
    stackSummary: `${stack[0]} 主导 → ${stack[1]} 辅助 · ${persona.cognitiveAxis}`,
    functionScores: normalizedScores,
    axisPercentages,
    alternateMbtis,
    keywords:
      customNarrative?.keywords && customNarrative.keywords.length > 0
        ? customNarrative.keywords.slice(0, 4)
        : [primaryMbti, `${stack[0]}-${stack[1]}`, persona.name],
    evidenceSummary: customNarrative?.evidenceSummary || defaultEvidence,
    disambiguationNote: customNarrative?.disambiguationNote || defaultDisambiguation,
    suggestedMaterialIds,
  };
}

/**
 * StepFun Cloud Adaptive Interviewer (PsyDI + Jungian 8-Function CAT architecture).
 * Enforces strict objectivity (no sycophancy / Barnum flattery), updates 8-function deltas
 * from the user's actual reasoning syntax, and generates targeted Top-1 vs Top-2 probes.
 */
async function runStepFunAdaptiveTurn(
  input: MbtiGuideTurnInput,
  baseScores: CognitiveFunctionScores,
  round: number,
  maxRounds: number,
  shouldConcludeNow: boolean
): Promise<{
  functionDeltas: Partial<CognitiveFunctionScores>;
  reaction?: string;
  nextQuestion?: MbtiGuideQuestion;
  narrative?: { evidenceSummary: string; disambiguationNote: string; keywords: string[] };
}> {
  const { ranked } = computeMbtiPosterior(baseScores);
  const top3Text = ranked
    .slice(0, 3)
    .map((r) => `${r.mbti}(${Math.round(r.probability * 100)}%, stack=${MBTI_FUNCTION_STACKS[r.mbti].join('-')})`)
    .join(', ');

  const transcript = input.history
    .map((h, i) => `第${i + 1}轮 题目：${h.questionPrompt}\n用户回答：${h.userAnswer}`)
    .join('\n\n');

  const systemInstruction = [
    '你是一位严谨、温和的荣格八维认知功能（Jungian 8 Cognitive Functions: Ni, Ne, Si, Se, Ti, Te, Fi, Fe）自适应测评访谈师，参考开源项目 opendilab/PsyDI 与计算机自适应测验（CAT）范式。',
    '核心准确度纪律：',
    '1. 严格客观，禁止巴纳姆效应奉承（sycophancy），只根据用户真实回答里流露的信息采集方式与决策依据给 8 维功能增量打分（范围 -1.5 到 +2.5，没体现的功能给 0）。',
    '2. 盲测原则：生成的下一道情景题绝对禁止出现 MBTI 字母或「外向/内向/理性/感性/计划/随性」等直接标签，必须用贴近日常或手作体验的真实微情景来探测认知机制。',
    '3. 当进入中后轮（round >= 3）时，必须重点设计能精准拉开当前 Top-1 与 Top-2 候选类型核心认知功能差异的鉴别题（例如 INFP 的 Fi-Ne vs INFJ 的 Ni-Fe；INTJ 的 Ni-Te vs INTP 的 Ti-Ne）。',
    '4. 选项设计：每个问题给 4 个等长度、无优劣偏见、口语自然的中文选项，且为每个选项标注准确的主导认知功能权重。',
  ].join('\n');

  const userPrompt = shouldConcludeNow
    ? [
        `当前已完成第 ${input.history.length} 轮对话，请对用户最后一轮回答提取 8 维功能增量，并结合全部对话给出最终高准确度荣格八维总结与 Top-1 vs Top-2 鉴别说明。`,
        `当前数学后验候选：${top3Text}`,
        `完整访谈记录：\n${transcript || '（无）'}`,
      ].join('\n\n')
    : [
        `请进行第 ${round}/${maxRounds} 轮自适应访谈。`,
        input.history.length > 0
          ? `请先根据用户上一轮回答给出精确的 8 维认知功能增量（delta），写一句 20~38 字的简短客观共鸣过渡（reaction），然后生成第 ${round} 轮高区分度情景题与 4 个无偏见选项。`
          : '这是第 1 轮开场题：请生成一个极具画面感、无偏见、高信息增益的日常/手作生活微情景题，覆盖 Ni/Ne/Si/Se 或 Ti/Te/Fi/Fe。',
        `当前数学后验 Top-3 候选：${top3Text}`,
        transcript ? `历史访谈记录：\n${transcript}` : '',
      ].join('\n\n');

  const parsed = await requestStepFunJson<{
    functionDeltas?: Partial<CognitiveFunctionScores>;
    reaction?: string;
    nextQuestion?: {
      phaseLabel?: string;
      targetAxes?: string;
      prompt?: string;
      options?: Array<{ id: string; label: string; weights?: Partial<CognitiveFunctionScores> }>;
    };
    evidenceSummary?: string;
    disambiguationNote?: string;
    keywords?: string[];
  }>(
    systemInstruction + '\n' +
      '只返回 JSON 对象。functionDeltas 为 Ni、Ne、Si、Se、Ti、Te、Fi、Fe 数值映射。' +
      '继续时给 reaction 和 nextQuestion，题目包含 phaseLabel、targetAxes、prompt、options。' +
      '每个选项包含 id、label 和数值映射 weights。结束时给 evidenceSummary、disambiguationNote、keywords 数组。',
    userPrompt,
  );

  // Clamp StepFun deltas so no single turn hijacks the psychometric posterior
  const clampedDeltas: Partial<CognitiveFunctionScores> = {};
  if (parsed.functionDeltas) {
    for (const fn of ALL_FUNCTIONS) {
      const v = Number(parsed.functionDeltas[fn]);
      if (Number.isFinite(v) && v !== 0) {
        clampedDeltas[fn] = Math.max(-1.5, Math.min(2.4, v));
      }
    }
  }

  let nextQuestion: MbtiGuideQuestion | undefined;
  if (
    !shouldConcludeNow &&
    parsed.nextQuestion?.prompt &&
    Array.isArray(parsed.nextQuestion.options) &&
    parsed.nextQuestion.options.length >= 2
  ) {
    nextQuestion = {
      id: `ai_q_${round}_${Date.now().toString(36)}`,
      round,
      phaseLabel: parsed.nextQuestion.phaseLabel || (round >= 4 ? '精准鉴别追问' : 'AI 情景访谈'),
      targetAxes: parsed.nextQuestion.targetAxes || '荣格八维认知机制',
      reaction: parsed.reaction || undefined,
      prompt: parsed.nextQuestion.prompt,
      options: parsed.nextQuestion.options.slice(0, 4).map((o, idx) => ({
        id: o.id || `opt_${round}_${idx}`,
        label: o.label,
        weights: o.weights || {},
      })),
    };
  }

  return {
    functionDeltas: clampedDeltas,
    reaction: parsed.reaction,
    nextQuestion,
    narrative: shouldConcludeNow
      ? {
          evidenceSummary: parsed.evidenceSummary || '',
          disambiguationNote: parsed.disambiguationNote || '',
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        }
      : undefined,
  };
}

export async function runMbtiGuideTurn(input: MbtiGuideTurnInput): Promise<MbtiGuideTurnOutput> {
  const maxRounds = Math.max(4, Math.min(8, input.maxRounds ?? 5));
  const completedRounds = input.history.length;
  const nextRound = completedRounds + 1;

  // 1. Apply deterministic psychometric scoring from the latest answer (option weights + Chinese cue parsing)
  let scores = sanitizeScores(input.rawScores);
  const latest = input.history[input.history.length - 1];
  if (latest) {
    if (latest.optionWeights && Object.keys(latest.optionWeights).length > 0) {
      scores = addWeights(scores, latest.optionWeights, 1.0);
    }
    // Always extract linguistic cognitive cues from free-text answers (stronger weight when user typed custom text)
    const isFreeText = !latest.selectedOptionId;
    const cues = extractChineseCognitiveCues(latest.userAnswer);
    scores = addWeights(scores, cues, isFreeText ? 1.15 : 0.3);
  }

  const prePosterior = computeMbtiPosterior(scores);
  const earlyConverged = completedRounds >= 5 && prePosterior.confidence >= 84;
  const shouldConcludeNow =
    Boolean(input.forceConclude) || completedRounds >= maxRounds || earlyConverged;

  const canUseStepFun = input.providerMode === 'cloud' && isChatCloudConfigured();

  // 2. Cloud StepFun Adaptive Engine (PsyDI + CAT)
  if (canUseStepFun) {
    try {
      const aiRes = await runStepFunAdaptiveTurn(
        input,
        scores,
        nextRound,
        maxRounds,
        shouldConcludeNow
      );

      // Fuse StepFun's cognitive evidence delta with our calibrated psychometric vector
      const latestWasFreeText = Boolean(latest && !latest.selectedOptionId);
      scores = addWeights(scores, aiRes.functionDeltas, latestWasFreeText ? 0.95 : 0.55);

      const post = computeMbtiPosterior(scores);
      const topCandidates = post.ranked.slice(0, 3).map((r) => ({
        mbti: r.mbti,
        probability: Math.round(r.probability * 100),
      }));

      if (shouldConcludeNow || !aiRes.nextQuestion) {
        return {
          status: 'completed',
          engine: 'stepfun_adaptive',
          round: completedRounds,
          maxRounds,
          confidence: post.confidence,
          topCandidates,
          rawScores: scores,
          normalizedScores: normalizeFunctionScores(scores),
          axisPercentages: post.axisPercentages,
          report: buildFinalReport(scores, input.inStockMaterials, aiRes.narrative),
        };
      }

      return {
        status: 'questioning',
        engine: 'stepfun_adaptive',
        round: nextRound,
        maxRounds,
        confidence: post.confidence,
        topCandidates,
        rawScores: scores,
        normalizedScores: normalizeFunctionScores(scores),
        axisPercentages: post.axisPercentages,
        nextQuestion: aiRes.nextQuestion,
      };
    } catch (err) {
      console.warn('[mbtiGuideEngine] StepFun adaptive turn failed:', (err as { code?: string }).code || 'PROVIDER_ERROR');
    }
  }

  // 3. Local High-Accuracy CAT Adaptive Engine (Zero-downtime fallback & deterministic precision)
  const post = computeMbtiPosterior(scores);
  const topCandidates = post.ranked.slice(0, 3).map((r) => ({
    mbti: r.mbti,
    probability: Math.round(r.probability * 100),
  }));

  if (shouldConcludeNow) {
    return {
      status: 'completed',
      engine: 'cat_local',
      round: completedRounds,
      maxRounds,
      confidence: post.confidence,
      topCandidates,
      rawScores: scores,
      normalizedScores: normalizeFunctionScores(scores),
      axisPercentages: post.axisPercentages,
      report: buildFinalReport(scores, input.inStockMaterials),
    };
  }

  const usedIds = new Set(input.history.map((h) => h.questionId));
  const picked = selectBestNextLocalScenario(usedIds, scores, nextRound);

  // Build crisp objective transition reaction based on live CAT convergence
  let reaction: string | undefined;
  if (completedRounds === 1) {
    reaction = '捕捉到你的第一层感知倾向了，接下来看你在权衡冲突时的核心判断方式。';
  } else if (completedRounds === 2) {
    reaction = '信息采集与判断轴已初步显影，这一轮我们来观察你的能量回血与表达节奏。';
  } else if (completedRounds >= 3 && topCandidates.length >= 2) {
    reaction = `目前你的认知特征集中在 ${topCandidates[0].mbti} 与 ${topCandidates[1].mbti} 之间，下面用一道针对性情景帮你精准区分。`;
  }

  return {
    status: 'questioning',
    engine: 'cat_local',
    round: nextRound,
    maxRounds,
    confidence: post.confidence,
    topCandidates,
    rawScores: scores,
    normalizedScores: normalizeFunctionScores(scores),
    axisPercentages: post.axisPercentages,
    nextQuestion: {
      id: picked.id,
      round: nextRound,
      phaseLabel: picked.phaseLabel,
      targetAxes: picked.targetAxes,
      reaction,
      prompt: picked.prompt,
      options: picked.options,
    },
  };
}
