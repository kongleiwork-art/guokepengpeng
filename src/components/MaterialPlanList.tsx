import { materialPart } from '../lib/materialCategories';
import { formatMaterialAmount } from '../lib/materialAmounts';
import type { AccessoryOption } from '../lib/types';

export function MaterialPlanList({ materials }: { materials: AccessoryOption[] }) {
  return (
    <section aria-label="备料清单" className="space-y-2.5">
      <div>
        <h3 className="text-sm font-semibold text-[#382A22]">备料清单</h3>
        <p className="mt-1 text-xs leading-relaxed text-[#6E5C50]">按 1 只娃娃备料。天然材料可挑接近建议尺寸的实物。</p>
      </div>
      <ul className="space-y-1.5">
        {materials.map(material => (
          <li key={material.id} className="flex items-start gap-2.5 rounded-xl border border-[#E8E1D6] bg-white px-2.5 py-2 text-xs">
            {material.referenceImageUrl && (
              <img src={material.referenceImageUrl} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md object-contain" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium text-[#382A22]">{material.label}</span>
                <span className="text-[11px] text-[#6E5C50]">{materialPart(material.id, material.category)}</span>
              </div>
              {material.amounts?.map((amount, index) => (
                <p key={index} className="font-medium tabular-nums leading-relaxed text-[#26544A]">{formatMaterialAmount(amount)}</p>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
