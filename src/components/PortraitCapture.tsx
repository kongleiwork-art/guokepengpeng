import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, ScanFace } from 'lucide-react';
import type { PortraitDetectors } from '../lib/portraitDetector';
import { copyVideoFrame, createFaceSampler, portraitPoseHint } from '../lib/portraitQuality';

type CaptureStage = 'idle' | 'opening' | 'loading' | 'scanning' | 'manual' | 'capturing';

interface PortraitCaptureProps {
  photoUrl: string | null;
  busy: boolean;
  analyzeOnCapture: boolean;
  onPhoto: (blob: Blob) => Promise<void>;
  onClear: () => void;
}

const idleHint = '把脸放在取景框中，稳定后会自动抓拍。';

function cameraAccessMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '请在浏览器的网站设置里允许摄像头，或从相册选一张照片。';
  }
  if (name === 'NotFoundError') return '没有可用的摄像头，请从相册选一张照片。';
  return '摄像头暂时无法打开，可以重试或从相册选照片。';
}

export function PortraitCapture({ photoUrl, busy, analyzeOnCapture, onPhoto, onClear }: PortraitCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camera = useRef<{
    revision: number;
    stream: MediaStream | null;
    detectors: PortraitDetectors | null;
    frameId: number;
  }>({ revision: 0, stream: null, detectors: null, frameId: 0 });
  const [stage, setStage] = useState<CaptureStage>('idle');
  const [hint, setHint] = useState(idleHint);
  const [inFrame, setInFrame] = useState(false);

  const releaseCamera = () => {
    const current = camera.current;
    current.revision += 1;
    cancelAnimationFrame(current.frameId);
    current.stream?.getTracks().forEach(track => track.stop());
    current.detectors?.close();
    current.stream = null;
    current.detectors = null;
    current.frameId = 0;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const stopCamera = (message = idleHint) => {
    releaseCamera();
    setInFrame(false);
    setStage('idle');
    setHint(message);
  };

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && camera.current.stream) stopCamera('回到页面后可重新开启摄像头。');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      releaseCamera();
    };
  }, []);

  const takePhoto = async (source: HTMLVideoElement | HTMLCanvasElement) => {
    let revision = camera.current.revision;
    try {
      const canvas = source instanceof HTMLCanvasElement ? source : copyVideoFrame(source);
      releaseCamera();
      revision = camera.current.revision;
      setInFrame(false);
      setStage('capturing');
      setHint('正在准备照片…');
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (camera.current.revision !== revision) return;
      if (!blob) throw new Error('No photo');
      await onPhoto(blob);
      if (camera.current.revision === revision) stopCamera();
    } catch {
      if (camera.current.revision === revision) stopCamera('这帧没有拍好，请重新开启摄像头。');
    }
  };

  const scanFrames = (models: PortraitDetectors, video: HTMLVideoElement, revision: number) => {
    const measure = createFaceSampler();
    let nextSampleAt = 0;
    let lastVideoTime = -1;
    let stable: { x: number; y: number; width: number; since: number; frames: number; bestScore: number; best: HTMLCanvasElement } | null = null;

    const scan = (now: number) => {
      if (camera.current.revision !== revision) return;
      if (now >= nextSampleAt && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
        nextSampleAt = now + 170;
        lastVideoTime = video.currentTime;
        try {
          const { detections } = models.detector.detectForVideo(video, now);
          const box = detections.length === 1 ? detections[0].boundingBox : undefined;
          const x = box ? (box.originX + box.width / 2) / video.videoWidth : 0;
          const y = box ? (box.originY + box.height / 2) / video.videoHeight : 0;
          let hint = detections.length > 1 ? '请让一位体验者留在画面里。' : !box ? '正在寻找人像，请看向镜头。'
            : box.width / video.videoWidth < 0.13 || x < 0.25 || x > 0.75 || y < 0.18 || y > 0.82
            ? '请靠近一点，把脸移到取景框中央。' : '';
          if (box && !hint) {
            const quality = measure(video, box);
            hint = quality.hint;
            if (!hint) {
              if (!stable || Math.hypot(x - stable.x, y - stable.y) > 0.06 || Math.abs(box.width / stable.width - 1) > 0.2) {
                stable = { x, y, width: box.width, since: now, frames: 0, bestScore: -1, best: document.createElement('canvas') };
              }
              stable.frames++;
              if (quality.sharpness > stable.bestScore) {
                copyVideoFrame(video, stable.best);
                stable.bestScore = quality.sharpness;
              }
              if (stable.frames >= 4 && now - stable.since >= 850) {
                const best = stable.best;
                hint = portraitPoseHint(models.landmarker.detect(best), best.width, best.height);
                if (!hint) {
                  void takePhoto(best);
                  return;
                }
              }
            }
          }
          if (hint) stable = null;
          setInFrame(!hint);
          setHint(hint || '画面清晰，请保持一秒。');
        } catch {
          models.close();
          camera.current.detectors = null;
          setInFrame(false);
          setStage('manual');
          setHint('当前设备无法自动抓拍，可以手动拍一张。');
          return;
        }
      }
      camera.current.frameId = requestAnimationFrame(scan);
    };
    camera.current.frameId = requestAnimationFrame(scan);
  };

  const startCamera = async () => {
    const video = videoRef.current;
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      stopCamera('请用 HTTPS 在浏览器打开，或从相册选一张照片。');
      return;
    }
    releaseCamera();
    const revision = camera.current.revision;
    setStage('opening');
    setHint('等待摄像头授权…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 960 }, height: { ideal: 960 } },
        audio: false,
      });
      if (camera.current.revision !== revision || document.hidden) {
        stream.getTracks().forEach(track => track.stop());
        if (camera.current.revision === revision) stopCamera('回到页面后可重新开启摄像头。');
        return;
      }
      camera.current.stream = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (camera.current.revision === revision) stopCamera('摄像头已关闭，请重新开启。');
      }, { once: true });
      video.srcObject = stream;
      await video.play();
    } catch (error) {
      if (camera.current.revision === revision) stopCamera(cameraAccessMessage(error));
      return;
    }
    if (camera.current.revision !== revision) return;
    setStage('loading');
    setHint('正在载入人像识别…');
    try {
      const { createPortraitDetectors } = await import('../lib/portraitDetector');
      if (camera.current.revision !== revision) return;
      const models = await createPortraitDetectors();
      if (camera.current.revision !== revision) {
        models.close();
        return;
      }
      camera.current.detectors = models;
      setStage('scanning');
      setHint('正在寻找人像，请看向镜头。');
      scanFrames(models, video, revision);
    } catch {
      if (camera.current.revision === revision) {
        camera.current.detectors?.close();
        camera.current.detectors = null;
        setStage('manual');
        setHint('当前设备的人像识别不可用，可以手动拍一张。');
      }
    }
  };

  const live = stage === 'loading' || stage === 'scanning' || stage === 'manual';
  const chooseFromAlbum = () => {
    stopCamera();
    fileRef.current?.click();
  };

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept="image/*" aria-label="从相册选择照片" className="sr-only"
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void onPhoto(file);
        }} disabled={busy || stage === 'capturing'} />

      <div className="aspect-[4/3] sm:aspect-[16/10] relative overflow-hidden rounded-2xl bg-[#312822]">
        {photoUrl ? (
          <img src={photoUrl} alt="已选照片" className="w-full h-full object-contain" />
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted aria-label="摄像头取景"
              className="w-full h-full object-contain -scale-x-100" />
            {stage === 'scanning' && (
              <div aria-hidden="true" className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                w-[44%] h-[72%] max-w-[245px] rounded-[42%] border-2 border-dashed pointer-events-none
                transition-colors ${inFrame ? 'border-[#A1E0CA]' : 'border-white/70'}`} />
            )}
            {!live && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#312822] px-5 text-center text-[#FFF9F0]">
                <ScanFace className="h-7 w-7 opacity-80" aria-hidden="true" />
                <p className="max-w-[26ch] text-sm leading-relaxed" role="status">{hint}</p>
                {stage === 'idle' && analyzeOnCapture && <p className="max-w-[32ch] text-xs text-[#E9DDCD]">
                  拍好或选好后，这张照片会发给阶跃星辰，推荐娃娃角色和用料。
                </p>}
                {stage === 'idle' && (
                  <button type="button" disabled={busy} onClick={() => void startCamera()}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#FFF9F0] px-4 text-sm font-semibold text-[#382A22] hover:bg-white">
                    <Camera className="h-4 w-4" /> {analyzeOnCapture ? '拍照并分析' : '开启摄像头'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {live && <p role="status" className="text-sm text-[#524339]">{hint}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {photoUrl && (
          <button type="button" onClick={onClear} disabled={busy} className="btn-paper-soft min-h-9 px-3 text-xs">
            移除照片
          </button>
        )}
        {live && (
          <button type="button" onClick={() => {
            if (videoRef.current?.videoWidth) void takePhoto(videoRef.current);
          }} className="btn-ink-tinted min-h-9 px-3 text-xs">{analyzeOnCapture ? '手动拍照并分析' : '手动拍摄'}</button>
        )}
        {(live || stage === 'opening') && (
          <button type="button" onClick={() => stopCamera()} className="btn-paper-soft min-h-9 px-3 text-xs">
            关闭摄像头
          </button>
        )}
        <button type="button" onClick={chooseFromAlbum} disabled={busy || stage === 'capturing'}
          className="btn-paper-soft inline-flex min-h-9 items-center gap-1.5 px-3 text-xs">
          <ImagePlus className="h-4 w-4" /> {analyzeOnCapture ? '选照片并分析' : '从相册选择'}
        </button>
      </div>
    </div>
  );
}
