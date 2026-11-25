import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
} from 'lucide-react';
import { api, ApiError, compressImageForUpload, generateIdempotencyKey } from '../lib/api';
import type {
  AccessoryOption,
  FallbackTemplate,
  MaterialCategory,
  MbtiRecommendation,
  MbtiQuizAnswers,
  PersonaPublic,
} from '../lib/types';
import { WatercolorPersonaGridSkeleton } from '../components/WatercolorLoader';
import { MbtiAiGuidePanel } from '../components/MbtiAiGuidePanel';
import { PortraitCapture } from '../components/PortraitCapture';
import { haptic } from '../lib/haptics';

type WizardStep = 1 | 2 | 3;

const CATEGORY_ORDER: MaterialCategory[] = [
  'nut_body',
  'yarn_hair',
  'fabric_outfit',
  'hardware_charm',
  'dried_botanical',
];

const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  nut_body: '天然果实主体',
  yarn_hair: '毛线与发丝',
  fabric_outfit: '布艺与服饰',
  hardware_charm: '挂饰与五金',
  dried_botanical: '干燥花草点缀',
};

const QUIZ_QUESTIONS = [
  { key: 'energy', text: '忙完一周，你更想怎样充电？', options: [['E', '和朋友聚一聚'], ['I', '自己安静待会儿']] },
  { key: 'perception', text: '拿到一袋做手工的材料，你先做什么？', options: [['S', '看看每件材料的质感和尺寸'], ['N', '想象它们能变成什么']] },
  { key: 'judgment', text: '两种设计意见不同，你通常先看什么？', options: [['T', '哪个更符合要求'], ['F', '哪个更照顾大家的感受']] },
  { key: 'lifestyle', text: '周末做手工时，你喜欢怎样安排？', options: [['J', '先列好步骤和时间'], ['P', '边做边尝试新想法']] },
] as const;

export function CreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetPersonaId = searchParams.get('personaId') || '';

  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const [personas, setPersonas] = useState<PersonaPublic[]>([]);
  const [accessories, setAccessories] = useState<AccessoryOption[]>([]);
  const [templates, setTemplates] = useState<FallbackTemplate[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creationEnabled, setCreationEnabled] = useState(false);
  const [photoMbtiEnabled, setPhotoMbtiEnabled] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<MbtiQuizAnswers>({});
  const [personaToolsOpened, setPersonaToolsOpened] = useState(false);

  const [step, setStep] = useState<WizardStep>(1);
  const [desktopRightTab, setDesktopRightTab] = useState<'persona' | 'accessories'>('persona');

  const [userNickname, setUserNickname] = useState('');
  const [personaId, setPersonaId] = useState('persona_enfp');
  const [personaMode, setPersonaMode] = useState<'ai_guide' | 'manual' | 'quiz'>(
    presetPersonaId ? 'manual' : 'ai_guide'
  );
  const [aiGuideOpened, setAiGuideOpened] = useState(false);
  const [showAllPersonas, setShowAllPersonas] = useState(false);
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);

  const [pendingAnalysis, setPendingAnalysis] = useState<'photo' | 'quiz' | null>(null);
  const recommending = pendingAnalysis !== null;
  const [recommendation, setRecommendation] = useState<MbtiRecommendation | null>(null);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [photoRecommendation, setPhotoRecommendation] = useState<MbtiRecommendation | null>(null);
  const [photoRecommendError, setPhotoRecommendError] = useState<string | null>(null);
  const draftRef = useRef<HTMLElement>(null);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoPreparing, setPhotoPreparing] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const idemKeyRef = useRef<string>(generateIdempotencyKey('card'));

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const capabilities = await api.capabilities();
        if (!active) return;
        setCreationEnabled(capabilities.imageGenerationEnabled);
        setPhotoMbtiEnabled(capabilities.photoMbtiEnabled);
        const startWithGuide = !capabilities.photoMbtiEnabled && !presetPersonaId;
        setPersonaMode(startWithGuide ? 'ai_guide' : 'manual');
        setAiGuideOpened(startWithGuide);
        await api.initSession();
        const [pList, aList, references] = await Promise.all([
          api.listPersonas(),
          api.listAccessories(),
          capabilities.photoMbtiEnabled ? api.listTemplates().catch(() => []) : Promise.resolve([]),
        ]);
        if (!active) return;
        setPersonas(pList);
        setAccessories(aList);
        setTemplates(references);

        const matchedPreset = presetPersonaId
          ? pList.find((p) => p.id === presetPersonaId || p.mbti.toLowerCase() === presetPersonaId.toLowerCase())
          : undefined;
        const initialPersona = matchedPreset ?? pList[0];
        if (initialPersona) {
          setPersonaId(initialPersona.id);
          if (!initialPersona.featured) {
            setShowAllPersonas(true);
          }
          const validIds = new Set(aList.map((a) => a.id));
          const recommended = (initialPersona.recommendedMaterials ?? []).filter((id) => validIds.has(id));
          if (recommended.length > 0) {
            setSelectedAccessories(recommended.slice(0, 3));
          } else if (aList.length > 0) {
            setSelectedAccessories(aList.slice(0, 2).map((a) => a.id));
          }
        }
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : '定制页面暂时不可用');
      } finally {
        if (active) setLoadingInit(false);
      }
    })();
    return () => { active = false; };
  }, [presetPersonaId]);

  useEffect(() => {
    const url = photoFile ? URL.createObjectURL(photoFile) : null;
    setPhotoPreviewUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [photoFile]);

  useEffect(() => {
    if (photoRecommendation) draftRef.current?.scrollIntoView({ block: 'nearest' });
  }, [photoRecommendation]);

  const clearPhoto = () => {
    setPhotoFile(null);
    setPhotoError(null);
    setPhotoRecommendError(null);
    setPhotoRecommendation(null);
    idemKeyRef.current = generateIdempotencyKey('card');
  };

  const acceptImageBlob = async (blob: Blob) => {
    setPhotoError(null);
    if (blob.size > 24 * 1024 * 1024) {
      setPhotoError('这张照片太大，请从相册选一张小于 24 MB 的照片。');
      return;
    }
    setPhotoPreparing(true);
    try {
      const compressed = await compressImageForUpload(blob);
      if (compressed.size > 2 * 1024 * 1024) {
        setPhotoError('压缩后图片仍大于 2 MB，请换一张照片。');
        return;
      }
      setPhotoFile(compressed);
      setPhotoRecommendation(null);
      setPhotoRecommendError(null);
      idemKeyRef.current = generateIdempotencyKey('card');
      haptic('success');
    } catch {
      setPhotoError('浏览器无法读取这张照片，请尝试 JPEG、PNG 或 WebP。');
    } finally {
      setPhotoPreparing(false);
    }
  };

  const applyPersonaSelection = (targetIdOrMbti: string, suggestedMatIds?: string[]) => {
    const matched = personas.find(
      (p) => p.id === targetIdOrMbti || p.mbti.toUpperCase() === targetIdOrMbti.toUpperCase()
    );
    if (!matched) return;
    haptic('selection');
    setPersonaId(matched.id);
    if (!matched.featured) setShowAllPersonas(true);
    if (suggestedMatIds && suggestedMatIds.length > 0) {
      const validIds = new Set(accessories.map((a) => a.id));
      const clean = suggestedMatIds.filter((id) => validIds.has(id)).slice(0, 6);
      if (clean.length > 0) setSelectedAccessories(clean);
    }
    idemKeyRef.current = generateIdempotencyKey('card');
  };

  const handleRecommend = async (source: 'photo' | 'quiz') => {
    if (recommending) return;
    const setError = source === 'photo' ? setPhotoRecommendError : setRecommendError;
    setError(null);
    if (source === 'photo' && (!photoMbtiEnabled || !photoFile || photoPreparing)) return;

    haptic('medium');
    setPendingAnalysis(source);
    try {
      const res = await api.recommendMbti(source === 'photo' ? { photo: photoFile } : { quizAnswers });
      if (source === 'photo') setPhotoRecommendation(res);
      else setRecommendation(res);
      applyPersonaSelection(res.primaryPersonaId, res.suggestedMaterialIds);
      haptic('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : '人格推荐分析失败，请稍后重试');
    } finally {
      setPendingAnalysis(null);
    }
  };

  const toggleAccessory = (id: string) => {
    haptic('selection');
    setSelectedAccessories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 6 ? [...prev, id] : prev
    );
    idemKeyRef.current = generateIdempotencyKey('card');
  };

  const applyRecommendedMaterials = () => {
    if (!activePersona) return;
    const validIds = new Set(accessories.map((a) => a.id));
    const rec = (activePersona.recommendedMaterials ?? []).filter((id) => validIds.has(id));
    if (rec.length > 0) {
      haptic('success');
      setSelectedAccessories(rec.slice(0, 6));
      idemKeyRef.current = generateIdempotencyKey('card');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || photoPreparing || recommending || !creationEnabled) return;
    setSubmitError(null);

    if (!photoFile) {
      setSubmitError('请先在第 1 步上传或拍摄参考照片。');
      setStep(1);
      return;
    }
    if (!userNickname.trim()) {
      setSubmitError('请先在第 1 步填写你的称呼。');
      setStep(1);
      return;
    }

    haptic('medium');
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('photo', photoFile);
      formData.append('userNickname', userNickname.trim());
      formData.append('personaId', personaId);
      formData.append('accessoryIds', JSON.stringify(selectedAccessories));
      if (photoRecommendation?.photoStyle) {
        formData.set('photoStyle', photoRecommendation.photoStyle);
      }
      if (photoRecommendation?.dollDesign && photoRecommendation.primaryPersonaId === personaId) {
        formData.set('dollDesign', photoRecommendation.dollDesign);
      }

      const res = await api.createCard(formData, idemKeyRef.current);
      navigate(`/create/processing?cardId=${encodeURIComponent(res.cardId)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(`[${err.code}] ${err.message}`);
      } else {
        setSubmitError(err instanceof Error ? err.message : '提交定制失败');
      }
      setSubmitting(false);
    }
  };

  const featuredPersonas = personas.filter((p) => p.featured);
  const visiblePersonas = showAllPersonas ? personas : featuredPersonas;
  const activePersona = personas.find((p) => p.id === personaId);
  const step1Done = Boolean(photoFile && userNickname.trim());

  const groupedMaterials = useMemo(() => {
    const groups = new Map<MaterialCategory, AccessoryOption[]>();
    for (const cat of CATEGORY_ORDER) {
      groups.set(cat, []);
    }
    for (const item of accessories) {
      const cat = (item.category || 'hardware_charm') as MaterialCategory;
      const list = groups.get(cat) ?? [];
      list.push(item);
      groups.set(cat, list);
    }
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      items: groups.get(cat) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [accessories]);

  const renderGenerateAction = () => (
    <div className="flex-1 space-y-1.5">
      <button type="submit" disabled={submitting || photoPreparing || recommending || !photoFile}
        className="btn-capsule-primary inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-sm font-medium disabled:opacity-55">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {submitting ? '正在提交绘制任务…' : '生成娃娃形象'}
      </button>
      <p className="text-xs leading-relaxed text-[#6E5C50]">提交后，将参考照片和当前方案发送给生图服务。</p>
    </div>
  );

  const renderPreparedDoll = () => {
    if (!photoRecommendation || !activePersona) return null;
    const reference = templates.find(template => template.recommendedMbti.includes(activePersona.mbti)) ??
      templates.find(template => template.recommendedMbti.some(mbti =>
        personas.find(persona => persona.mbti === mbti)?.mbtiGroup === activePersona.mbtiGroup
      )) ?? templates[0];
    const suggestedRole = photoRecommendation.primaryPersonaId === activePersona.id;
    const materials = selectedAccessories.flatMap(id => {
      const item = accessories.find(accessory => accessory.id === id);
      return item ? [item] : [];
    });
    const roles = [...new Set([photoRecommendation.primaryMbti, ...photoRecommendation.alternateMbtis, activePersona.mbti])];
    return (
      <section ref={draftRef} aria-labelledby="doll-draft-title"
        className="space-y-4 rounded-2xl border border-[#D8E6DF] bg-[#F3F8F4] p-4">
        <div>
          <h2 id="doll-draft-title" className="font-editorial text-lg font-semibold text-[#382A22]">娃娃方案已准备</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#6E5C50]">性格是娃娃的创作设定，可以按你的喜好调整。</p>
        </div>
        <div className="grid items-start gap-3 min-[440px]:grid-cols-[6rem_minmax(0,1fr)]">
          {reference && (
            <figure className="max-w-36">
              <img src={reference.imageUrl} alt={reference.name} className="aspect-square w-full rounded-xl object-cover" />
              <figcaption className="mt-1 text-[11px] text-[#6E5C50]">工坊参考样式</figcaption>
            </figure>
          )}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[#382A22]">{activePersona.name} · {activePersona.mbti}</p>
            <p className="text-sm leading-relaxed text-[#524339]">{photoRecommendation.photoStyle}</p>
            <p className="text-sm leading-relaxed text-[#524339]">
              {suggestedRole ? photoRecommendation.dollDesign : activePersona.visualTrait || activePersona.materialHint}
            </p>
          </div>
        </div>
        {suggestedRole && <p className="text-xs leading-relaxed text-[#6E5C50]">{photoRecommendation.reason}</p>}
        {materials.length > 0 && (
          <ul aria-label="已准备的材料" className="flex flex-wrap gap-1.5">
            {materials.map(material => (
              <li key={material.id} className="rounded-full bg-white px-2.5 py-1 text-xs text-[#26544A]">{material.label}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2" aria-label="调整娃娃性格">
          <span className="text-xs text-[#6E5C50]">换个性格</span>
          {roles.map(mbti => (
            <button key={mbti} type="button" disabled={submitting} aria-pressed={activePersona.mbti === mbti}
              className="btn-paper-soft min-h-8 px-2.5 text-xs font-mono aria-pressed:bg-[#D8EBE3]"
              onClick={() => {
                const persona = personas.find(item => item.mbti === mbti);
                const items = mbti === photoRecommendation.primaryMbti
                  ? photoRecommendation.suggestedMaterialIds
                  : persona?.recommendedMaterials;
                applyPersonaSelection(mbti, items);
              }}>{mbti}</button>
          ))}
        </div>
        {creationEnabled ? renderGenerateAction() : (
          <p className="text-xs text-[#6E5C50]">完整定制出图待开放</p>
        )}
      </section>
    );
  };

  const renderPortraitTools = () => (
    <div className="space-y-4">
      <PortraitCapture photoUrl={photoPreviewUrl} busy={photoPreparing || recommending || submitting}
        onPhoto={acceptImageBlob} onClear={clearPhoto} />

      {photoError && <p role="alert" className="text-xs text-[#9E3D2E]">{photoError}</p>}
      {photoMbtiEnabled && photoFile && !photoRecommendation && (
        <div className="space-y-2">
          <button type="button" onClick={() => void handleRecommend('photo')}
            disabled={photoPreparing || recommending || submitting}
            className="btn-capsule-primary inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm font-medium disabled:opacity-55">
            <Sparkles className="h-4 w-4" />
            {pendingAnalysis === 'photo' ? '正在分析照片…' : '分析这张照片'}
          </button>
          <p className="text-xs leading-relaxed text-[#6E5C50]">确认后，将这张照片发送给阶跃星辰用于娃娃创作。</p>
          {photoRecommendError && <p role="alert" className="text-xs text-[#9E3D2E]">{photoRecommendError}</p>}
        </div>
      )}
    </div>
  );

  const renderPhotoAndNickname = () => (
    <div className="space-y-4">
      <h2 className="font-editorial text-base font-semibold text-[#382A22]">参考照片与称呼</h2>
      {renderPortraitTools()}
      {/* Nickname input right below photo */}
      <div className="space-y-1.5 pt-2 border-t border-[#EFE7DC]">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="userNickname" className="text-xs font-medium text-[#382A22]">
            你的称呼
          </label>
          <span className="text-[11px] text-[#9A887B]">绑定后自动写入角色记忆</span>
        </div>
        <input
          id="userNickname"
          type="text"
          required
          disabled={submitting}
          maxLength={32}
          value={userNickname}
          onChange={(e) => {
            setUserNickname(e.target.value);
            idemKeyRef.current = generateIdempotencyKey('card');
          }}
          placeholder="例如：小林"
          className="w-full px-3.5 py-2.5 text-[16px] sm:text-sm bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#4A8276]/20 focus:border-[#4A8276] transition-colors"
        />
      </div>
      {renderPreparedDoll()}
    </div>
  );

  const renderPersonaStep = () => (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-atelier-num italic text-[14px] text-[#4A8276]">02.</span>
          <h2 className="font-editorial text-base font-semibold text-[#382A22]">
            果壳娃娃人格
          </h2>
        </div>

        {/* Mode Switcher: AI Guided Interview vs Direct 16-MBTI Picker */}
        <div className="inline-flex items-center rounded-xl bg-[#F2ECE2] p-0.5 border border-[#E5DCCD]">
          <button
            type="button"
            onClick={() => {
              haptic('selection');
              setPersonaMode('ai_guide');
              setAiGuideOpened(true);
            }}
            className={`px-2.5 py-1 text-[11.5px] font-medium rounded-lg transition-colors whitespace-nowrap ${
              personaMode === 'ai_guide'
                ? 'bg-white text-[#2C6155] shadow-xs'
                : 'text-[#7D6C5F] hover:text-[#382A22]'
            }`}
          >
            AI 引导测评
          </button>
          <button type="button" onClick={() => { setRecommendError(null); setPersonaMode('quiz'); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${personaMode === 'quiz' ? 'bg-white text-[#382A22]' : 'text-[#7D6C5F]'}`}>
            4 题快测
          </button>
          <button
            type="button"
            onClick={() => {
              haptic('selection');
              setPersonaMode('manual');
            }}
            className={`px-2.5 py-1 text-[11.5px] font-medium rounded-lg transition-colors whitespace-nowrap ${
              personaMode === 'manual'
                ? 'bg-white text-[#2C6155] shadow-xs'
                : 'text-[#7D6C5F] hover:text-[#382A22]'
            }`}
          >
            直接选 16 型
          </button>
        </div>
      </div>

      {/* Keep interview progress when switching tabs after opening it. */}
      <div className={personaMode === 'ai_guide' ? 'block space-y-3' : 'hidden'}>
        {aiGuideOpened && <MbtiAiGuidePanel onApplyPersona={applyPersonaSelection} />}
      </div>

      {personaMode === 'quiz' && (
        <section className="space-y-3">
          {QUIZ_QUESTIONS.map(({ key, text, options }) => (
            <fieldset key={key} className="rounded-xl border border-[#E6DDD0] bg-[#FFFDF9] px-3 py-2">
              <legend className="px-1 text-xs font-medium text-[#382A22]">{text}</legend>
              <div className="flex flex-wrap gap-2">
                {options.map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 px-1 py-1 text-xs text-[#6E5C50]">
                    <input type="radio" name={`personality-${key}`} value={value} checked={quizAnswers[key] === value}
                      onChange={() => setQuizAnswers((current) => ({ ...current, [key]: value }))} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <button type="button" className="btn-ink-tinted px-4 py-2 text-xs"
            disabled={recommending || Object.keys(quizAnswers).length !== QUIZ_QUESTIONS.length}
            onClick={() => void handleRecommend('quiz')}>
            {recommending ? '分析中…' : '查看推荐人格'}
          </button>
          {recommendError && <p role="alert" className="text-xs text-[#9E3D2E]">{recommendError}</p>}
          {recommendation && <p className="text-sm text-[#382A22]"><strong>{recommendation.primaryMbti}</strong> {recommendation.reason}</p>}
        </section>
      )}

      {/* Mode B: Direct 16-MBTI Picker + Optional Selfie Analysis */}
      {personaMode === 'manual' && (
        <div className="space-y-3.5">
          <div className="p-3 rounded-2xl bg-[#F7F3EB]/90 border border-[#E6DDD0] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#382A22]">选择喜欢的娃娃性格</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    haptic('selection');
                    setShowAllPersonas((v) => !v);
                  }}
                  className="text-xs font-medium btn-icon-ghost text-[#4A8276] whitespace-nowrap"
                >
                  {showAllPersonas ? '收起精选 4 型' : `全部 ${personas.length} 型`}
                </button>
              </div>
            </div>

            {recommendError && (
              <p className="text-[11.5px] text-[#9E3D2E] bg-[#FDF2F0] border border-[#E5B8B0] rounded-lg px-2.5 py-1.5">
                {recommendError}
              </p>
            )}

            {recommendation && (
              <div className="p-3 rounded-xl bg-[#FFFDF9] border border-[#C6E1D9] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono font-bold text-[#2D6458] bg-[#E8F4F0] px-2 py-0.5 rounded-md">
                      问答推荐 {recommendation.primaryMbti}
                    </span>
                    {recommendation.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="text-[11px] text-[#6E5C50] bg-[#F7F2E8] px-2 py-0.5 rounded-md"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                  {recommendation.alternateMbtis.length > 0 && (
                    <div className="flex items-center gap-1 text-[11px] text-[#8E7C6E]">
                      <span>备选:</span>
                      {recommendation.alternateMbtis.map((alt) => (
                        <button
                          key={alt}
                          type="button"
                          onClick={() => applyPersonaSelection(alt)}
                          className="font-mono text-[#4A8276] hover:underline px-1"
                        >
                          {alt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[11.5px] text-[#524339] leading-relaxed">{recommendation.reason}</p>
              </div>
            )}
          </div>

          {loadingInit ? (
            <WatercolorPersonaGridSkeleton count={4} />
          ) : (
            <div
              className={`grid gap-2.5 ${
                showAllPersonas ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'
              }`}
            >
              {visiblePersonas.map((p) => {
                const selected = p.id === personaId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-pressable="card"
                    onClick={() => applyPersonaSelection(p.id)}
                    className={`text-left rounded-2xl border transition-all ${
                      showAllPersonas ? 'p-2.5' : 'p-3.5'
                    } ${
                      selected
                        ? 'border-[#4A8276] specimen-stage-0 shadow-[0_6px_18px_-8px_rgba(74,130,118,0.3)]'
                        : 'border-[#E8DFD2] bg-[#FFFDF9] hover:border-[#CFC4B5]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-mono font-semibold text-[#3D7267]">
                        {p.mbti}
                      </span>
                      {selected && <Check className="w-3.5 h-3.5 text-[#3D7267]" strokeWidth={2.4} />}
                    </div>
                    <div className="font-editorial text-[13.5px] font-semibold text-[#382A22] mt-0.5 truncate">
                      {p.name}
                    </div>
                    {!showAllPersonas && (
                      <p className="text-[11px] text-[#6E5C50] mt-1 line-clamp-2 leading-snug">
                        {p.tagline}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activePersona && (
        <div className="space-y-2">
          <blockquote className="atelier-pullquote px-3.5 py-2.5 text-[12px] text-[#6E5C50] leading-relaxed">
            <span className="font-medium text-[#382A22]">
              当前已选 {activePersona.mbti} · {activePersona.name} 开场白：
            </span>
            “{activePersona.openingLine}”
          </blockquote>
          {activePersona.cognitiveAxis && (
            <div className="px-3 py-2 rounded-xl studio-inset text-[11px] text-[#6E5C50] flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-[#3D7267] font-medium">
                {activePersona.cognitiveAxis}
              </span>
              <span aria-hidden="true">·</span>
              <span className="line-clamp-1">{activePersona.materialHint}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderAccessoriesStep = () => (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-atelier-num italic text-[14px] text-[#4A8276]">03.</span>
          <h2 className="font-editorial text-base font-semibold text-[#382A22]">
            在库手作材料（最多 6 项）
          </h2>
        </div>
        <div className="flex items-center gap-2.5">
          {activePersona && (activePersona.recommendedMaterials?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={applyRecommendedMaterials}
              className="text-[11.5px] font-medium text-[#4A8276] hover:underline whitespace-nowrap"
            >
              套用 {activePersona.mbti} 推荐搭配
            </button>
          )}
          <span className="text-xs font-mono tabular-nums text-[#4A8276] font-medium">
            已选 {selectedAccessories.length} / 6
          </span>
        </div>
      </div>

      <p className="text-[11.5px] text-[#8E7C6E] leading-relaxed">
        材料来自工坊库存，生成娃娃形象时会用作造型参考。
      </p>

      <div className="space-y-3 max-h-[340px] lg:max-h-[370px] overflow-y-auto pr-1">
        {groupedMaterials.map((group) => (
          <div key={group.category} className="space-y-1.5">
            <div className="text-[11px] font-medium text-[#8E7C6E] tracking-wide">
              {group.label}
            </div>
            <div className="flex flex-wrap gap-2">
              {group.items.map((acc) => {
                const picked = selectedAccessories.includes(acc.id);
                const isRecommended = activePersona?.recommendedMaterials?.includes(acc.id);
                return (
                  <button
                    key={acc.id}
                    type="button"
                    data-pressable="card"
                    onClick={() => toggleAccessory(acc.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-left transition-all ${
                      picked
                        ? 'border-[#4A8276] bg-[#EAF5F1] text-[#26544A] shadow-[0_2px_8px_-2px_rgba(74,130,118,0.22)]'
                        : 'border-[#E6DDD0] bg-[#FFFEFC] hover:border-[#CFC4B5] text-[#382A22]'
                    }`}
                  >
                    <span className="text-[12px] font-medium whitespace-nowrap">{acc.label}</span>
                    <span className="text-[10.5px] text-[#9A887B] whitespace-nowrap">
                      {acc.material}
                    </span>
                    {isRecommended && !picked && (
                      <span className="text-[10px] text-[#C9963B] font-medium">荐</span>
                    )}
                    {picked && (
                      <Check className="w-3.5 h-3.5 shrink-0 text-[#4A8276]" strokeWidth={2.4} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Compact Configuration Summary */}
      <div className="p-3 rounded-xl studio-inset flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#6E5C50]">
        <span>
          照片：
          <strong className={photoFile ? 'text-[#4A8276]' : 'text-[#B84A39]'}>
            {photoFile ? '已选取' : '待选取'}
          </strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          称呼：<strong className="text-[#382A22]">{userNickname.trim() || '未填写'}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          人格：<strong className="font-mono text-[#4A8276]">{activePersona?.mbti || '-'}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          材料：<strong className="text-[#382A22]">{selectedAccessories.length} 项</strong>
        </span>
      </div>
    </div>
  );

  if (loadingInit) {
    return <div role="status" className="mx-auto max-w-2xl p-6 text-sm text-[#6E5C50]">正在加载工坊…</div>;
  }

  if (!creationEnabled || loadError) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <section className="studio-card space-y-2 rounded-[20px] p-5">
          <h1 className="font-editorial text-xl font-semibold text-[#382A22]">
            {loadError ? '定制工坊暂时不可用' : photoMbtiEnabled ? '拍照准备娃娃' : '照片定制 · 待开放'}
          </h1>
          {loadError
            ? <p role="alert" className="text-sm text-[#6E5C50]">{loadError}</p>
            : <p className="text-sm text-[#6E5C50]">
                {photoMbtiEnabled ? '在设备上实时取景，选好照片后准备娃娃的性格、配色和配饰。' : '可以先测果壳娃娃人格，或去展馆和演示娃娃聊天。'}
              </p>}
          <Link to="/plaza" className="inline-block text-sm font-medium text-[#3D7267]">逛果壳展馆</Link>
        </section>
        {!loadError && photoMbtiEnabled && (
          <section className="studio-card space-y-4 rounded-[20px] p-4 sm:p-5">
            {renderPortraitTools()}
            {renderPreparedDoll()}
          </section>
        )}
        {!loadError && (photoMbtiEnabled ? (
          <details className="studio-card rounded-[20px] p-4 sm:p-5"
            onToggle={event => { if (event.currentTarget.open) setPersonaToolsOpened(true); }}>
            <summary className="cursor-pointer text-sm font-medium text-[#3D7267]">通过问答挑选性格</summary>
            {personaToolsOpened && <div className="mt-4">{renderPersonaStep()}</div>}
          </details>
        ) : <section className="studio-card rounded-[20px] p-5">{renderPersonaStep()}</section>)}
      </div>
    );
  }

  return (
    <div className="max-w-[1160px] mx-auto px-3.5 sm:px-8 py-3 sm:py-6 space-y-3.5 sm:space-y-5">
      {/* Mobile Native 3-Step Segmented Wizard Bar (lg:hidden) */}
      <div className="lg:hidden ios-segmented grid grid-cols-3">
        {(
          [
            { key: 1 as const, label: '1 照片称呼', done: step1Done },
            { key: 2 as const, label: '2 人格设定', done: Boolean(activePersona) },
            { key: 3 as const, label: '3 材料生成', done: selectedAccessories.length > 0 },
          ] as const
        ).map((item) => {
          const active = step === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                haptic('selection');
                setStep(item.key);
              }}
              className={`relative py-2 px-2 text-[12px] font-medium rounded-[10px] transition-colors whitespace-nowrap ${
                active ? 'text-[#382A22]' : 'text-[#7D6C5F]'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="create-step-thumb"
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                  className="absolute inset-0 ios-segmented-thumb"
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1">
                <span>{item.label}</span>
                {item.done && item.key < step && (
                  <Check className="w-3 h-3 text-[#4A8276]" strokeWidth={2.5} />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Mobile One-Screen Step Card (rendered only on <1024px so AI Guide mounts once & preserves progress) */}
        {!isDesktop && (
          <div className="studio-card rounded-[20px] p-4 space-y-4">
            {step === 1 && renderPhotoAndNickname()}
            <div className={step === 2 ? 'block' : 'hidden'}>{renderPersonaStep()}</div>
            <div className={step === 3 ? 'block' : 'hidden'}>{renderAccessoriesStep()}</div>

            {submitError && (
              <div role="alert" className="p-3 rounded-xl border border-[#E5B8B0] bg-[#FDF2F0] text-xs text-[#9E3D2E]">
                {submitError}
              </div>
            )}

            <div className="pt-3 border-t border-[#EFE7DC] flex items-center justify-between gap-2.5">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    haptic('selection');
                    setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s));
                  }}
                  className="inline-flex items-center justify-center gap-1 px-4 py-2 text-xs font-medium btn-paper-soft whitespace-nowrap"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>上一步</span>
                </button>
              ) : (
                <span className="text-[11px] text-[#9A887B]">共 3 步 · AI 精准引导</span>
              )}

              {step < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    haptic('light');
                    setStep((s) => (s < 3 ? ((s + 1) as WizardStep) : s));
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-[13px] font-medium btn-ink-tinted whitespace-nowrap"
                >
                  <span>{step === 1 ? '下一步 · 选性格' : '下一步 · 挑材料'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                renderGenerateAction()
              )}
            </div>
          </div>
        )}

        {/* Desktop Compact Single-Screen 2-Column Studio (rendered only on >=1024px) */}
        {isDesktop && (
          <div className="grid grid-cols-12 gap-6 items-start">
            <section className="col-span-5 studio-card rounded-[20px] p-6 space-y-5">
              {renderPhotoAndNickname()}
              {submitError && (
                <div role="alert" className="p-3 rounded-xl border border-[#E5B8B0] bg-[#FDF2F0] text-xs text-[#9E3D2E]">
                  {submitError}
                </div>
              )}
              {!photoRecommendation && renderGenerateAction()}
            </section>

            <section className="col-span-7 studio-card rounded-[20px] p-6 space-y-5">
              <div className="flex items-center justify-between gap-4 border-b border-[#EFE7DC] pb-4">
                <div>
                  <h1 className="font-editorial text-xl font-semibold text-[#382A22]">
                    定制专属果壳娃娃
                  </h1>
                  <p className="text-xs text-[#9A887B] mt-0.5">
                    选择娃娃的性格和工坊材料，生成专属形象。
                  </p>
                </div>
                <div className="ios-segmented grid grid-cols-2 w-[240px] shrink-0">
                  {(
                    [
                      { key: 'persona', label: `人格 (${activePersona?.mbti || 'MBTI'})` },
                      { key: 'accessories', label: `材料 (${selectedAccessories.length}/6)` },
                    ] as const
                  ).map((t) => {
                    const active = desktopRightTab === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => {
                          haptic('selection');
                          setDesktopRightTab(t.key);
                        }}
                        className={`relative py-1.5 px-2.5 text-xs font-medium rounded-[10px] transition-colors whitespace-nowrap ${
                          active ? 'text-[#382A22]' : 'text-[#7D6C5F]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="desktop-create-tab"
                            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                            className="absolute inset-0 ios-segmented-thumb"
                          />
                        )}
                        <span className="relative z-10">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={desktopRightTab === 'persona' ? 'block' : 'hidden'}>
                {renderPersonaStep()}
              </div>
              <div className={desktopRightTab === 'accessories' ? 'block' : 'hidden'}>
                {renderAccessoriesStep()}
              </div>
            </section>
          </div>
        )}
      </form>
    </div>
  );
}
