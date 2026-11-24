import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Radio } from 'lucide-react';
import { api } from '../lib/api';
import { haptic } from '../lib/haptics';

export function NfcRedirectPage() {
  const { alias = '' } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.initSession();
        const res = await api.resolveNfcAlias(alias);
        if (!active) return;
        haptic('success');
        navigate(`/d/${encodeURIComponent(res.dollId)}?entry=nfc&alias=${encodeURIComponent(res.alias)}`, {
          replace: true,
        });
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '未找到该 NFC 标签对应的果壳娃娃');
      }
    })();
    return () => {
      active = false;
    };
  }, [alias, navigate]);

  if (error) {
    return (
      <div className="max-w-[540px] mx-auto px-4 py-12">
        <div className="studio-card rounded-[22px] p-6 space-y-4 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-[#FDF2F0] border border-[#E5B8B0] flex items-center justify-center text-[#B84A39]">
            <Radio className="w-5 h-5" />
          </div>
          <h1 className="font-editorial text-xl font-semibold text-[#382A22]">
            NFC 标签暂未绑定娃娃
          </h1>
          <p className="text-xs text-[#6E5C50] leading-relaxed">{error}</p>
          <div className="pt-2 flex items-center justify-center gap-3">
            <Link to="/" className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium btn-ink-tinted">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回展馆</span>
            </Link>
            <Link to="/dev" className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium btn-paper-soft">
              <span>前往 NFC 工坊绑定</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[460px] mx-auto px-4 py-16 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-full bg-[#EAF5F1] border border-[#C3DFD5] flex items-center justify-center text-[#3D7267] animate-pulse">
        <Radio className="w-5 h-5" />
      </div>
      <p className="font-editorial text-base font-semibold text-[#382A22]">正在唤醒果壳娃娃…</p>
      <p className="text-xs font-mono text-[#9A887B]">NFC · {alias}</p>
    </div>
  );
}
