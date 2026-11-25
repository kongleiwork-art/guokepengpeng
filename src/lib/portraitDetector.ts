import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import simdLoader from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url';
import simdWasm from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url';
import plainLoader from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js?url';
import plainWasm from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm?url';

export async function createPortraitDetector(): Promise<FaceDetector> {
  const simd = await FilesetResolver.isSimdSupported();
  return FaceDetector.createFromOptions({
    wasmLoaderPath: simd ? simdLoader : plainLoader,
    wasmBinaryPath: simd ? simdWasm : plainWasm,
  }, {
    baseOptions: { modelAssetPath: import.meta.env.BASE_URL + 'models/blaze-face-short-range.tflite', delegate: 'CPU' },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.6,
  });
}
