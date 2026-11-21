import type { ImageGenerateInput, ImageGenerateResult, ImageProvider } from './imageProvider.ts';
import type { OutputJobInput, OutputJobResult, OutputProvider } from './outputProvider.ts';

/**
 * RDK 本地生图适配器接口预留（本版不部署板端模型）
 *
 * 后续接入方式：
 * 1. 在板端 RDK（如地平线 RDK X5）启动本地 HTTP 推理服务，暴露 POST /v1/generate。
 * 2. 新增环境变量 RDK_IMAGE_ENDPOINT 与 IMAGE_PROVIDER=rdk。
 * 3. 在 getImageProvider() 中路由到 RdkImageProvider，无需改动前端与业务 API。
 */
export class RdkImageProvider implements ImageProvider {
  readonly mode = 'rdk' as const;

  async generate(_input: ImageGenerateInput, _signal: AbortSignal): Promise<ImageGenerateResult> {
    throw Object.assign(
      new Error('RDK 本地生图执行器尚未接入（本版仅保留标准契约，请使用 cloud 或 mock）'),
      { code: 'PROVIDER_NOT_CONFIGURED' }
    );
  }
}

/**
 * 机械臂 / 实体打印机出图适配器接口预留（本版不实现运动控制与实体出图）
 *
 * 后续接入方式：
 * 1. 接收已锁定的 cardVersionId 与持久化的 resultUrl。
 * 2. 在此适配器内部完成位图到 SVG/G-Code 路径转换，并下发机械臂或热敏/喷墨打印机。
 * 3. 实体完成后返回 physicalExecuted: true 与 mode: 'arm' | 'printer'。
 */
export class ArmOutputProvider implements OutputProvider {
  readonly mode = 'arm' as const;

  async execute(_input: OutputJobInput): Promise<OutputJobResult> {
    throw Object.assign(
      new Error('机械臂实体出图执行器尚未接入（本版固定为 mock 模拟出图）'),
      { code: 'PROVIDER_NOT_CONFIGURED' }
    );
  }
}
