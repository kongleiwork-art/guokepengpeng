import { materialPart } from '../lib/materialCategories';
import type { AccessoryOption } from '../lib/types';

export function MaterialPlanList({ materials }: { materials: AccessoryOption[] }) {
  return (
    <ul aria-label="材料与部位" className="flex flex-wrap gap-1.5">
      {materials.map(material => (
        <li key={material.id} className="flex items-center gap-1.5 rounded-xl bg-white px-2 py-1 text-xs text-[#26544A]">
          {material.referenceImageUrl && (
            <img src={material.referenceImageUrl} alt="" className="h-9 w-9 rounded-md object-contain" />
          )}
          <span>
            <span className="block text-[10px] text-[#6E5C50]">{materialPart(material.id, material.category)}</span>
            {material.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
