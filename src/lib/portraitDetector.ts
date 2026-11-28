import { FaceDetector, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import simdLoader from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url';
import simdWasm from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url';
import plainLoader from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js?url';
import plainWasm from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm?url';

export async function createPortraitDetectors() {
  const simd = await FilesetResolver.isSimdSupported();
  const fileset = {
    wasmLoaderPath: simd ? simdLoader : plainLoader,
    wasmBinaryPath: simd ? simdWasm : plainWasm,
  };
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: import.meta.env.BASE_URL + 'models/blaze-face-short-range.tflite', delegate: 'CPU' },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.6,
  });
  try {
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: import.meta.env.BASE_URL + 'models/face_landmarker.task', delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 2,
      outputFaceBlendshapes: true,
    });
    return { detector, landmarker, close() { detector.close(); landmarker.close(); } };
  } catch (error) {
    detector.close();
    throw error;
  }
}

export type PortraitDetectors = Awaited<ReturnType<typeof createPortraitDetectors>>;
