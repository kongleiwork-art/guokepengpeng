export interface OutputJobInput {
  jobId: string;
  cardId: string;
  cardVersionId: string;
  resultUrl: string;
  resultKind: string;
  paperSize: string;
  simulateFail?: boolean;
}

export interface OutputJobResult {
  mode: 'mock' | 'arm' | 'printer';
  physicalExecuted: boolean;
  artifactNote: string;
}

export interface OutputProvider {
  readonly mode: 'mock' | 'arm' | 'printer';
  execute(input: OutputJobInput): Promise<OutputJobResult>;
}

class MockOutputProvider implements OutputProvider {
  readonly mode = 'mock' as const;

  async execute(input: OutputJobInput): Promise<OutputJobResult> {
    await new Promise((r) => setTimeout(r, 2200));

    if (input.simulateFail) {
      throw Object.assign(new Error('（Mock 模拟）模拟出图执行失败，未触发实体设备'), {
        code: 'PROVIDER_ERROR',
      });
    }

    return {
      mode: 'mock',
      physicalExecuted: false,
      artifactNote: `已完成模拟出图校验（纸张 ${input.paperSize}，锁定版本 ${input.cardVersionId}，未执行物理打印或机械臂绘图）`,
    };
  }
}

const mockOutputProvider = new MockOutputProvider();

export function getOutputProvider(): OutputProvider {
  return mockOutputProvider;
}
