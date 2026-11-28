import type { BoundingBox, FaceLandmarkerResult } from '@mediapipe/tasks-vision';

const SAMPLE_SIZE = 96;

export function measureFacePixels(rgba: Uint8ClampedArray, size: number) {
  const luma = new Float32Array(size * size);
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < luma.length; i++) {
    const value = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
    luma[i] = value;
    sum += value;
    if (value > 249) clipped++;
  }
  let lapSum = 0;
  let lapSquares = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const lap = luma[i - 1] + luma[i + 1] + luma[i - size] + luma[i + size] - 4 * luma[i];
      lapSum += lap;
      lapSquares += lap * lap;
    }
  }
  const count = (size - 2) ** 2;
  const sharpness = lapSquares / count - (lapSum / count) ** 2;
  const brightness = sum / luma.length;
  const hint = brightness < 40 ? '光线较暗，请移到亮一些的地方。'
    : brightness > 232 || clipped / luma.length > 0.35 ? '光线太强，请避开直射光。'
    : sharpness < 18 ? '画面有点模糊，请稳住手机，等镜头对焦。' : '';
  return { sharpness, hint };
}

export function createFaceSampler() {
  const sample = document.createElement('canvas');
  sample.width = sample.height = SAMPLE_SIZE;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable');
  return (video: HTMLVideoElement, box: BoundingBox) => {
    ctx.drawImage(video, box.originX + box.width * 0.15, box.originY + box.height * 0.15,
      box.width * 0.7, box.height * 0.7, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return measureFacePixels(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data, SAMPLE_SIZE);
  };
}

export function portraitPoseHint(result: Pick<FaceLandmarkerResult, 'faceLandmarks' | 'faceBlendshapes'>, width: number, height: number) {
  if (result.faceLandmarks.length > 1) return '请让一位体验者留在画面里。';
  const points = result.faceLandmarks[0];
  const left = points?.[33], right = points?.[263], nose = points?.[1];
  if (!left || !right || !nose) return '请面向镜头，让整张脸出现在画面里。';
  const dx = (right.x - left.x) * width;
  const dy = (right.y - left.y) * height;
  const eyeDistance = Math.hypot(dx, dy);
  if (eyeDistance < 1 || Math.abs(Math.atan2(dy, dx)) > Math.PI / 9) return '请把头摆正一些。';
  const noseX = (nose.x - (left.x + right.x) / 2) * width;
  const noseY = (nose.y - (left.y + right.y) / 2) * height;
  if (Math.abs(noseX * dx + noseY * dy) / eyeDistance ** 2 > 0.26) return '请转向正前方，看向镜头。';
  const blinks = result.faceBlendshapes[0]?.categories.filter(item =>
    (item.categoryName === 'eyeBlinkLeft' || item.categoryName === 'eyeBlinkRight') && item.score > 0.65);
  return blinks?.length === 2 ? '请睁开眼睛，看向镜头。' : '';
}

export function copyVideoFrame(video: HTMLVideoElement, canvas = document.createElement('canvas')) {
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) throw new Error('No camera frame');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}
