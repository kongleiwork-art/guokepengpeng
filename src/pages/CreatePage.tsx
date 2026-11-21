import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Camera, Check, RefreshCw, Upload, X } from 'lucide-react';
import { api, ApiError, compressImageForUpload, generateIdempotencyKey } from '../lib/api';
import type { AccessoryOption, PersonaPublic } from '../lib/types';
import { WatercolorPersonaGridSkeleton } from '../components/WatercolorLoader';
import { haptic } from '../lib/haptics';

const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

type WizardStep = 1 | 2 | 3;

export function CreatePage() {
  const navigate = useNavigate();
  const [personas, setPersonas] = useState<PersonaPublic[]>([]);
  const [accessories, setAccessories] = useState<AccessoryOption[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);

  const [step, setStep] = useState<WizardStep>(1);
  const [desktopRightTab, setDesktopRightTab] = useState<'persona' | 'accessories'>('persona');

  const [userNickname, setUserNickname] = useState('');
  const [personaId, setPersonaId] = useState('persona_enfp');
  const [showAllPersonas, setShowAllPersonas] = useState(false);
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([
    'hat_gingham',
    'bell_copper',
  ]);

  const [photoSourceMode, setPhotoSourceMode] = useState<'upload' | 'camera'>('upload');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoInfo, setPhotoInfo] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const idemKeyRef = useRef<string>(generateIdempotencyKey('card'));

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.initSession();
        const [pList, aList] = await Promise.all([api.listPersonas(), api.listAccessories()]);
        if (!active) return;
        setPersonas(pList);
        setAccessories(aList);
        if (pList.length > 0) setPersonaId(pList[0].id);
        if (aList.length > 0) {
          setSelectedAccessories((prev) => {
            const validIds = new Set(aList.map((a) => a.id));
            const filtered = prev.filter((id) => validIds.has(id));
            return filtered.length > 0 ? filtered : [aList[0].id];
          });
        }
      } finally {
        if (active) setLoadingInit(false);
      }
    })();
    return () => {
      active = false;
      stopCamera();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('当前浏览器不支持摄像头采集，请改用相册上传。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `无法打开摄像头：${err.message}`
          : '无法打开摄像头，请改用相册上传'
      );
    }
  };

  const handleCaptureSnapshot = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    haptic('medium');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
    );
    if (!blob) return;
    stopCamera();
    await acceptImageBlob(blob, '摄像头拍摄');
  };

  const acceptImageBlob = async (blob: Blob, sourceLabel: string) => {
    setPhotoError(null);
    try {
      const compressed = await compressImageForUpload(blob);
      if (compressed.size > 2 * 1024 * 1024) {
        setPhotoError('压缩后图片仍大于 2 MB，请换一张分辨率略低的照片。');
        return;
      }
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      const url = URL.createObjectURL(compressed);
      setPhotoFile(compressed);
      setPhotoPreviewUrl(url);
      setPhotoInfo(`${sourceLabel} · ${(compressed.size / 1024).toFixed(0)} KB`);
      idemKeyRef.current = generateIdempotencyKey('card');
    } catch {
      setPhotoError('无法解码该文件，请上传 JPEG、PNG 或 WebP 照片。');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (file.type && !allowed.includes(file.type)) {
      setPhotoError('仅支持 JPEG、PNG 或 WebP 格式的照片。');
      return;
    }
    await acceptImageBlob(file, file.name);
  };

  const toggleAccessory = (id: string) => {
    haptic('selection');
    setSelectedAccessories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev
    );
    idemKeyRef.current = generateIdempotencyKey('card');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
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

  const renderPhotoAndNickname = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-atelier-num italic text-[14px] text-[#4A8276]">01.</span>
          <h2 className="font-editorial text-base font-semibold text-[#382A22]">参考照片与称呼</h2>
        </div>

        <div className="flex items-center gap-3.5">
          {(
            [
              { key: 'upload', label: '相册' },
              { key: 'camera', label: '拍摄' },
            ] as const
          ).map((mode) => {
            const active = photoSourceMode === mode.key;
            return (
              <button
                key={mode.key}
                type="button"
                onClick={() => {
                  haptic('selection');
                  if (mode.key === 'upload') {
                    stopCamera();
                    setPhotoSourceMode('upload');
                  } else {
                    setPhotoSourceMode('camera');
                    void startCamera();
                  }
                }}
                className={`relative pb-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  active ? 'text-[#382A22]' : 'text-[#9A887B] hover:text-[#382A22]'
                }`}
              >
                {mode.label}
                {active && (
                  <motion.span
                    layoutId="photo-mode-ink"
                    transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                    className="absolute left-0 right-0 -bottom-0.5 h-[2px] bg-[#4A8276]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {photoPreviewUrl && !cameraActive ? (
        <div className="space-y-2">
          <div className="relative aspect-[16/10] lg:aspect-[4/3] rounded-2xl overflow-hidden border border-[#EAE2D6] bg-white p-1.5">
            <img
              src={photoPreviewUrl}
              alt="待上传照片预览"
              className="w-full h-full object-cover rounded-xl"
            />
            <button
              type="button"
              onClick={() => {
                haptic('light');
                setPhotoFile(null);
                setPhotoPreviewUrl(null);
                setPhotoInfo(null);
              }}
              aria-label="移除照片"
              className="absolute top-3 right-3 w-8 h-8 btn-orb-glass hover:text-[#B84A39] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-[#9A887B]">
            <span className="truncate">{photoInfo}</span>
            <button
              type="button"
              onClick={() => {
                if (photoSourceMode === 'camera') {
                  void startCamera();
                } else {
                  setPhotoFile(null);
                  setPhotoPreviewUrl(null);
                }
              }}
              className="inline-flex items-center gap-1 font-medium btn-icon-ghost whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3 h-3 text-[#4A8276]" />
              <span>重选</span>
            </button>
          </div>
        </div>
      ) : photoSourceMode === 'camera' ? (
        <div className="space-y-2.5">
          <div className="aspect-[16/10] lg:aspect-[4/3] rounded-2xl overflow-hidden border border-[#EAE2D6] bg-[#2D241E] flex items-center justify-center relative">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-[#FAF7F2] text-xs space-y-2.5 bg-[#2D241E]/92">
                <Camera className="w-5 h-5 opacity-80" />
                <p className="max-w-[26ch] leading-relaxed text-[#E4DBCE]">
                  {cameraError || '点击开启摄像头取景框'}
                </p>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="px-4 py-1.5 rounded-full border border-[#FAF7F2]/55 text-[#FAF7F2] hover:bg-white/10 font-medium"
                >
                  打开摄像头
                </button>
              </div>
            )}
          </div>
          {cameraActive && (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => void handleCaptureSnapshot()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium btn-capsule-primary"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>拍摄照片</span>
              </button>
              <button
                type="button"
                onClick={stopCamera}
                className="px-3.5 py-2 text-xs font-medium btn-icon-ghost"
              >
                取消
              </button>
            </div>
          )}
        </div>
      ) : (
        <label className="group photo-mat-frame block aspect-[16/10] lg:aspect-[4/3] rounded-2xl border border-dashed border-[#D3C6B4] specimen-stage-1 hover:border-[#4A8276] transition-all duration-300 cursor-pointer overflow-hidden">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="sr-only"
          />
          <div className="relative z-10 w-full h-full flex flex-col items-center justify-center p-4 text-center space-y-2.5">
            <div className="w-11 h-11 rounded-full bg-[#FFFDF9]/90 border border-[#D8CEC0] group-hover:border-[#4A8276] group-hover:bg-[#ECF5F2] shadow-[0_4px_12px_-4px_rgba(56,42,34,0.12)] flex items-center justify-center text-[#3D7267] transition-all duration-300 group-hover:-translate-y-0.5">
              <Upload className="w-4 h-4" />
            </div>
            <div className="space-y-0.5">
              <p className="font-editorial text-[14px] font-semibold text-[#382A22]">
                点击上传参考照片
              </p>
              <p className="text-[11px] text-[#8E7C6E]">
                支持 JPEG/PNG/WebP · 仅用于水彩形象，24h 自动清理
              </p>
            </div>
          </div>
        </label>
      )}

      {photoError && (
        <p className="text-xs text-[#9E3D2E] bg-[#FDF2F0] border border-[#E5B8B0] rounded-lg px-3 py-2">
          {photoError}
        </p>
      )}

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
    </div>
  );

  const renderPersonaStep = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-atelier-num italic text-[14px] text-[#4A8276]">02.</span>
          <h2 className="font-editorial text-base font-semibold text-[#382A22]">
            角色人格（16 型 MBTI）
          </h2>
        </div>
        <button
          type="button"
          onClick={() => {
            haptic('selection');
            setShowAllPersonas((v) => !v);
          }}
          className="text-xs font-medium btn-icon-ghost text-[#4A8276] whitespace-nowrap"
        >
          {showAllPersonas ? '收起为精选 4 型' : `全部 ${personas.length} 型`}
        </button>
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
                onClick={() => {
                  haptic('selection');
                  setPersonaId(p.id);
                  idemKeyRef.current = generateIdempotencyKey('card');
                }}
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

      {activePersona && (
        <blockquote className="atelier-pullquote px-3.5 py-2.5 text-[12px] text-[#6E5C50] leading-relaxed">
          <span className="font-medium text-[#382A22]">{activePersona.mbti} 开场白：</span>
          “{activePersona.openingLine}”
        </blockquote>
      )}
    </div>
  );

  const renderAccessoriesStep = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-atelier-num italic text-[14px] text-[#4A8276]">03.</span>
          <h2 className="font-editorial text-base font-semibold text-[#382A22]">
            手作配饰（最多 4 项）
          </h2>
        </div>
        <span className="text-xs font-mono tabular-nums text-[#4A8276] font-medium">
          已选 {selectedAccessories.length} / 4
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {accessories.map((acc, idx) => {
          const picked = selectedAccessories.includes(acc.id);
          const swatchColors = [
            '#C9963B',
            '#639A8C',
            '#C97A6A',
            '#9A85B4',
            '#B38B63',
            '#5B8B7E',
            '#D4A95B',
            '#8E6C52',
          ];
          const swatch = swatchColors[idx % swatchColors.length];
          return (
            <button
              key={acc.id}
              type="button"
              data-pressable="card"
              onClick={() => toggleAccessory(acc.id)}
              className={`inline-flex items-center gap-2 pl-2.5 pr-3.5 py-2 rounded-full border text-left transition-all ${
                picked
                  ? 'border-[#4A8276] bg-[#EAF5F1] text-[#26544A] shadow-[0_2px_8px_-2px_rgba(74,130,118,0.22)]'
                  : 'border-[#E6DDD0] bg-[#FFFEFC] hover:border-[#CFC4B5] text-[#382A22]'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/10"
                style={{ backgroundColor: swatch }}
                aria-hidden="true"
              />
              <span className="text-[12px] font-medium whitespace-nowrap">{acc.label}</span>
              <span className="text-[10.5px] text-[#9A887B] whitespace-nowrap">
                {acc.material}
              </span>
              {picked && <Check className="w-3.5 h-3.5 shrink-0 text-[#4A8276]" strokeWidth={2.4} />}
            </button>
          );
        })}
      </div>

      {/* Compact Configuration Summary */}
      <div className="p-3 rounded-xl studio-inset flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#6E5C50]">
        <span>
          照片：
          <strong className={photoFile ? 'text-[#4A8276]' : 'text-[#B84A39]'}>
            {photoFile ? '已上传' : '未上传'}
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
      </div>
    </div>
  );

  return (
    <div className="max-w-[1160px] mx-auto px-3.5 sm:px-8 py-3 sm:py-6 space-y-3.5 sm:space-y-5">
      {/* Mobile Native 3-Step Segmented Wizard Bar (lg:hidden) */}
      <div className="lg:hidden ios-segmented grid grid-cols-3">
        {(
          [
            { key: 1 as const, label: '1 照片称呼', done: step1Done },
            { key: 2 as const, label: '2 人格设定', done: Boolean(activePersona) },
            { key: 3 as const, label: '3 配饰生成', done: selectedAccessories.length > 0 },
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
        {/* Mobile One-Screen Step Card (lg:hidden) */}
        <div className="lg:hidden studio-card rounded-[20px] p-4 space-y-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2, ease: EASE_STUDIO }}
            >
              {step === 1 && renderPhotoAndNickname()}
              {step === 2 && renderPersonaStep()}
              {step === 3 && renderAccessoriesStep()}
            </motion.div>
          </AnimatePresence>

          {submitError && (
            <div className="p-3 rounded-xl border border-[#E5B8B0] bg-[#FDF2F0] text-xs text-[#9E3D2E]">
              {submitError}
            </div>
          )}

          {/* Step Footer Controls — Clearly Differentiated Shapes & Weight */}
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
              <span className="text-[11px] text-[#9A887B]">共 3 步 · 约 20 秒</span>
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
                <span>{step === 1 ? '下一步 · 选人格' : '下一步 · 配饰'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting || !photoFile || !userNickname.trim()}
                className="flex-1 inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium btn-capsule-primary whitespace-nowrap"
              >
                {submitting ? '正在创建绘制任务…' : '开始生成角色形象'}
              </button>
            )}
          </div>
        </div>

        {/* Desktop Compact Single-Screen 2-Column Studio (hidden lg:grid) */}
        <div className="hidden lg:grid lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-5 studio-card rounded-[20px] p-6 space-y-5">
            {renderPhotoAndNickname()}
            {submitError && (
              <div className="p-3 rounded-xl border border-[#E5B8B0] bg-[#FDF2F0] text-xs text-[#9E3D2E]">
                {submitError}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting || !photoFile || !userNickname.trim()}
              className="w-full inline-flex items-center justify-center px-6 py-3 text-sm font-medium btn-capsule-primary whitespace-nowrap"
            >
              {submitting ? '正在创建绘制任务…' : '开始生成角色形象'}
            </button>
          </section>

          <section className="lg:col-span-7 studio-card rounded-[20px] p-6 space-y-5">
            <div className="flex items-center justify-between gap-4 border-b border-[#EFE7DC] pb-4">
              <div>
                <h1 className="font-editorial text-xl font-semibold text-[#382A22]">
                  定制专属果壳娃娃
                </h1>
                <p className="text-xs text-[#9A887B] mt-0.5">
                  人格与手作配饰均由你指定，初次生成后支持最多 2 次重生成。
                </p>
              </div>
              <div className="ios-segmented grid grid-cols-2 w-[230px] shrink-0">
                {(
                  [
                    { key: 'persona', label: `人格 (${activePersona?.mbti || 'MBTI'})` },
                    { key: 'accessories', label: `配饰 (${selectedAccessories.length}/4)` },
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

            <AnimatePresence mode="wait">
              <motion.div
                key={desktopRightTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: EASE_STUDIO }}
              >
                {desktopRightTab === 'persona' ? renderPersonaStep() : renderAccessoriesStep()}
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      </form>
    </div>
  );
}
