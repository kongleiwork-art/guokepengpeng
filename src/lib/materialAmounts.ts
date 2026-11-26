import type { MaterialAmount } from './types.ts';

const SIZE_LABEL = { length: '长', width: '宽', height: '高', diameter: '直径' };
const amountFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

export function formatMaterialAmount({ quantity, unit, action, part, size }: MaterialAmount): string {
  const verb = action === 'pick' ? '取' : size?.kind === 'rectangle' ? '裁' : '剪';
  const quantityText = `${verb} ${amountFormatter.format(quantity)} ${unit}${part ?? ''}`;
  if (!size) return quantityText;

  const each = quantity > 1 ? `每${unit}` : '';
  if (size.kind === 'rectangle') {
    return `${quantityText}，${each}${size.lengthCm} × ${size.widthCm} cm（长 × 宽）`;
  }
  const dimension = `${each}${SIZE_LABEL[size.kind]}${action === 'pick' ? '约' : ''} ${amountFormatter.format(size.cm)} cm`;
  const total = action === 'cut' && size.kind === 'length' && quantity > 1
    ? `，共 ${amountFormatter.format(quantity * size.cm)} cm` : '';
  return `${quantityText}，${dimension}${total}`;
}
