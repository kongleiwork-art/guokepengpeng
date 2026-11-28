import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { MbtiGuideTurnResponse, MbtiScenarioAnswer, MbtiScenarioChoice } from '../lib/types';

const CHOICES: Array<[MbtiScenarioChoice, string]> = [
  ['a', '更像 A'], ['lean-a', '稍偏 A'], ['both', '两边相近'], ['lean-b', '稍偏 B'], ['b', '更像 B'],
];
const AXIS_LABELS = { EI: ['外向', '内向'], SN: ['实感', '直觉'], TF: ['思考', '情感'], JP: ['判断', '感知'] };

export function useScenarioQuiz(opened: boolean) {
  const [turn, setTurn] = useState<MbtiGuideTurnResponse | null>(null);
  const [answers, setAnswers] = useState<MbtiScenarioAnswer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const failed = useRef<MbtiScenarioAnswer[]>([]);

  const submit = useCallback(async (next: MbtiScenarioAnswer[]) => {
    if (pending.current) return;
    pending.current = true;
    setError('');
    setBusy(true);
    try {
      const result = await api.mbtiGuideTurn(next);
      setAnswers(next);
      setTurn(result);
    } catch (err) {
      failed.current = next;
      setError(err instanceof Error ? err.message : '连接中断，请重试。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => { if (opened) void submit([]); }, [opened, submit]);

  const answer = (choice: MbtiScenarioChoice) => {
    if (turn?.status !== 'questioning') return;
    const questionId = turn.nextQuestion.id;
    void submit([...answers.filter(item => item.questionId !== questionId), { questionId, choice }]);
  };
  return { turn, busy, error, answer, back: () => submit(answers.slice(0, -1)), restart: () => submit([]), retry: () => submit(failed.current) };
}

export function MbtiScenarioPanel({ quiz, appliedId, onApplyPersona }: {
  quiz: ReturnType<typeof useScenarioQuiz>;
  appliedId: string | null;
  onApplyPersona: (id: string, materials: string[]) => void;
}) {
  const { turn, busy, error } = quiz;
  return (
    <section aria-label="情景测验" aria-busy={busy} className="space-y-3 rounded-2xl border border-[#E6DDD0] bg-[#FFFDF9] p-4">
      {!turn && !error && <p role="status" className="text-sm">正在读取情景题…</p>}
      {turn?.status === 'questioning' && <>
        <p className="text-xs font-medium text-[#3D7267]" aria-live="polite">
          {turn.answered < turn.baseTotal ? '基础题' : '补充题'} · 第 {turn.answered + 1} / {turn.total} 题
        </p>
        {turn.answered === 0 && <p className="text-xs text-[#6E5C50]">按平时更常见的做法选。12 道基础题后，倾向接近的维度各补 1 题。</p>}
        <h3 className="font-editorial text-base font-semibold leading-relaxed">{turn.nextQuestion.prompt}</h3>
        <div className="space-y-2 text-sm leading-relaxed text-[#524339]">
          <p><b className="mr-2 text-[#3D7267]">A</b>{turn.nextQuestion.a}</p>
          <p><b className="mr-2 text-[#3D7267]">B</b>{turn.nextQuestion.b}</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="选择倾向">
          {CHOICES.map(([value, label]) => <button key={value} type="button" disabled={busy}
            className="btn-paper-soft min-h-10 px-3 text-xs disabled:opacity-50" onClick={() => quiz.answer(value)}>{label}</button>)}
        </div>
      </>}
      {turn?.status === 'completed' && <>
        <h3 className="font-editorial text-base font-semibold">你的情景测验结果</h3>
        <div className="space-y-2 text-xs text-[#524339]">
          {turn.report.axes.map(({ axis, score, balanced }) => (
            <div key={axis} className="grid grid-cols-[4rem_1fr_4rem] items-center gap-2">
              <span>{axis[0]} {AXIS_LABELS[axis][0]}</span>
              <div className="text-center">
                <span>{balanced ? '两边接近' : '偏向 ' + (score > 0 ? axis[0] : axis[1])}</span>
                <div aria-hidden="true" className="relative mt-1 h-1 rounded-full bg-[#E5DFD4]">
                  <span className="absolute -top-0.5 h-2 w-2 -translate-x-1/2 rounded-full bg-[#4A8276]" style={{ left: (50 - score * 0.48) + '%' }} />
                </div>
              </div>
              <span className="text-right">{axis[1]} {AXIS_LABELS[axis][1]}</span>
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-[#6E5C50]">{turn.report.primaryPersonaId
          ? '按这次作答，最贴近的娃娃角色是「' + turn.report.candidates[0].name + '」。'
          : turn.report.candidates.length ? '有些维度的倾向接近，可以挑一个喜欢的娃娃角色。'
          : '四个维度两边都接近。可以直接选一个喜欢的角色，或重新作答。'}</p>
        <div className="flex flex-wrap gap-2">
          {turn.report.candidates.map(candidate => <button type="button" key={candidate.personaId}
            aria-pressed={appliedId === candidate.personaId} disabled={busy}
            className="btn-ink-tinted min-h-10 px-3 text-xs"
            onClick={() => onApplyPersona(candidate.personaId, candidate.suggestedMaterialIds)}>
            {appliedId === candidate.personaId ? '已采用' : '采用'} {candidate.mbti} · {candidate.name}
          </button>)}
        </div>
      </>}
      {error && <div role="alert" className="text-xs text-[#9E3D2E]">{error}
        <button type="button" className="ml-2 underline" disabled={busy} onClick={quiz.retry}>重试</button>
      </div>}
      {turn && turn.answered > 0 && <div className="flex gap-4 text-xs text-[#3D7267]">
        <button type="button" disabled={busy} className="py-1" onClick={quiz.back}>返回上一题</button>
        {turn.status === 'completed' && <button type="button" disabled={busy} className="py-1" onClick={quiz.restart}>重新测验</button>}
      </div>}
    </section>
  );
}
