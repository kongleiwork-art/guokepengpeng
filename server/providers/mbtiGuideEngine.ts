import type { MaterialRecord, MbtiAxis, MbtiGuideReport, MbtiGuideTurnResponse, MbtiScenarioAnswer } from '../../src/lib/types.ts';
import { recommendedMaterialIds } from '../../src/lib/materialCategories.ts';
import { FOLLOW_UP_QUESTIONS, SCENARIO_QUESTIONS } from '../data/mbtiQuestions.ts';
import { PERSONA_SEEDS } from '../data/seed.ts';

const AXES: MbtiAxis[] = ['EI', 'SN', 'TF', 'JP'];
const CHOICE_POINTS = { a: 2, 'lean-a': 1, both: 0, 'lean-b': -1, b: -2 } as const;
const ALL_QUESTIONS = [...SCENARIO_QUESTIONS, ...FOLLOW_UP_QUESTIONS];
const QUESTION_IDS = new Set(ALL_QUESTIONS.map(question => question.id));

function invalidAnswers(message: string): never {
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_SCENARIO_ANSWERS' });
}

function readAnswers(input: unknown[]) {
  if (input.length > ALL_QUESTIONS.length * 2) invalidAnswers('答题记录超出题目数量，请重新开始。');
  const answers = new Map<string, MbtiScenarioAnswer['choice']>();
  for (const item of input) {
    if (!item || typeof item !== 'object') invalidAnswers('答题记录格式不正确。');
    const { questionId, choice } = item as Partial<MbtiScenarioAnswer>;
    if (typeof questionId !== 'string' || !QUESTION_IDS.has(questionId) ||
        typeof choice !== 'string' || !Object.hasOwn(CHOICE_POINTS, choice)) {
      invalidAnswers('遇到无效的题目或选项，请重新开始。');
    }
    const previous = answers.get(questionId);
    if (previous && previous !== choice) invalidAnswers('同一题有两个不同答案，请重新选择。');
    answers.set(questionId, choice);
  }
  return answers;
}

function scoreAxes(
  questions: typeof ALL_QUESTIONS,
  answers: ReturnType<typeof readAnswers>,
): MbtiGuideReport['axes'] {
  return AXES.map(axis => {
    const points = questions.flatMap(question => {
      const choice = answers.get(question.id);
      return question.axis === axis && choice ? [CHOICE_POINTS[choice] * question.aDirection] : [];
    });
    const sum = points.reduce((total, point) => total + point, 0);
    const score = points.length ? Math.round(sum * 50 / points.length) : 0;
    return { axis, score, balanced: Math.abs(score) <= 25 };
  });
}

export function runMbtiGuideTurn(input: unknown[], materials: MaterialRecord[]): MbtiGuideTurnResponse {
  const answers = readAnswers(input);
  const hasBaseAnswers = SCENARIO_QUESTIONS.every(question => answers.has(question.id));
  const balancedAxes = new Set(scoreAxes(SCENARIO_QUESTIONS, answers).filter(item => item.balanced).map(item => item.axis));
  const followUps = hasBaseAnswers ? FOLLOW_UP_QUESTIONS.filter(question => balancedAxes.has(question.axis)) : [];
  const planned = [...SCENARIO_QUESTIONS, ...followUps];
  const allowed = new Set(planned.map(question => question.id));
  if ([...answers.keys()].some(id => !allowed.has(id))) invalidAnswers('请先完成当前情景题，再回答补充题。');

  const progress = { answered: answers.size, total: planned.length, baseTotal: SCENARIO_QUESTIONS.length };
  const pending = planned.find(question => !answers.has(question.id));
  if (pending) {
    const { id, prompt, a, b } = pending;
    return { ...progress, status: 'questioning', nextQuestion: { id, prompt, a, b } };
  }

  const axes = scoreAxes(planned, answers);
  const ranked = axes.some(item => item.score !== 0)
    ? PERSONA_SEEDS.map(persona => ({
        persona,
        fit: axes.reduce((fit, item, index) => fit + item.score * (persona.mbti[index] === item.axis[0] ? 1 : -1), 0),
      })).sort((a, b) => b.fit - a.fit).slice(0, 2)
    : [];
  const candidates = ranked.map(({ persona }) => ({
    personaId: persona.id,
    mbti: persona.mbti,
    name: persona.name,
    suggestedMaterialIds: recommendedMaterialIds(persona.recommendedMaterials, materials),
  }));
  const primaryPersonaId = axes.every(item => !item.balanced) ? candidates[0]?.personaId : undefined;
  return { ...progress, status: 'completed', report: { primaryPersonaId, axes, candidates } };
}
