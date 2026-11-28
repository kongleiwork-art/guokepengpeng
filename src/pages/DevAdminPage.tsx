import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Package,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import {
  isIosDevice,
  isWebNfcSupported,
  readUrlFromNfcTag,
  writeUrlToNfcTag,
} from '../lib/webNfc';
import type {
  DemoStatusPayload,
  ImageModelTier,
  ImageVendor,
  MaterialCategory,
  MaterialRecord,
  ProviderMode,
  SessionInfo,
} from '../lib/types';
import { haptic } from '../lib/haptics';
import { MATERIAL_CATEGORY_LABELS as CATEGORY_LABELS } from '../lib/materialCategories';

type DevTab = 'overview' | 'nfc' | 'materials' | 'sessions' | 'logs';
const EASE_STUDIO = [0.22, 1, 0.36, 1] as const;

const SAMPLE_IMPORT_TEMPLATE = [
  {
    id: 'nut_walnut_custom',
    label: '文玩小核桃壳',
    category: 'nut_body',
    material: '天然打磨核桃壳',
    visualHint: 'polished miniature natural walnut shell doll body with warm brown wood grain',
    inStock: true,
  },
  {
    id: 'charm_wooden_tag',
    label: '刻字小木牌',
    category: 'hardware_charm',
    material: '椴木激光雕刻',
    visualHint: 'tiny rectangular hand-sanded basswood charm tag tied with hemp string',
    inStock: true,
  },
];

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DevAdminPage() {
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem('nutshell_admin_token') || ''
  );
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<DemoStatusPayload | null>(null);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [activeTab, setActiveTab] = useState<DevTab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  // Runtime settings state
  const [savingSettings, setSavingSettings] = useState(false);
  const [nfcBaseUrlInput, setNfcBaseUrlInput] = useState('');

  // NFC workshop state
  const [nfcFeedback, setNfcFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [nfcBusyAlias, setNfcBusyAlias] = useState<string | null>(null);
  const [testTagsConfirmed, setTestTagsConfirmed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState('');
  const [newAliasDollId, setNewAliasDollId] = useState('');
  const [newAliasLabel, setNewAliasLabel] = useState('');

  // Materials inventory state
  const [newMatLabel, setNewMatLabel] = useState('');
  const [newMatCategory, setNewMatCategory] = useState<MaterialCategory>('hardware_charm');
  const [newMatMaterial, setNewMatMaterial] = useState('');
  const [newMatVisualHint, setNewMatVisualHint] = useState('');
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [matBusy, setMatBusy] = useState(false);

  useEffect(() => {
    void api.initSession().then(setCurrentSession).catch(() => {});
  }, []);

  const loadAllAdminData = async (tokenToUse: string) => {
    const trimmed = tokenToUse.trim();
    if (!trimmed) {
      setError('请输入 DEMO_ADMIN_TOKEN 后加载状态。');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [data, matRes] = await Promise.all([
        api.getDemoStatus(trimmed),
        api.listAdminMaterials(trimmed),
      ]);
      sessionStorage.setItem('nutshell_admin_token', trimmed);
      setStatus(data);
      setMaterials(matRes.items);
      setNfcBaseUrlInput(data.settings.nfcPublicBaseUrl || '');
      if (!newAliasDollId && data.dollsForNfc.length > 0) {
        setNewAliasDollId(data.dollsForNfc[0].id);
      }
    } catch (err) {
      setStatus(null);
      if (err instanceof ApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : '加载系统状态失败');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (adminToken) {
      void loadAllAdminData(adminToken);
    }
  }, []);

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    haptic('light');
    setNotice(null);
    void loadAllAdminData(adminToken);
  };

  const handleUpdateSettings = async (
    patch: Partial<{
      nfcPublicBaseUrl: string;
      imageModelTier: ImageModelTier;
      imageVendor: ImageVendor;
      chatProviderMode: ProviderMode;
      imageProviderMode: ProviderMode;
      strictMaterialConstraint: boolean;
    }>,
    successMsg: string
  ) => {
    if (!adminToken.trim() || savingSettings) return;
    setSavingSettings(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateDemoSettings(adminToken.trim(), patch);
      haptic('success');
      setNotice(successMsg);
      await loadAllAdminData(adminToken.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新运行配置失败');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      haptic('success');
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      setError('剪贴板写入受限，请手动选择复制。');
    }
  };

  const nfcScope = status?.settings.nfcWriteScope ?? 'unavailable';
  const canWriteTag = nfcScope === 'production' || (nfcScope === 'test' && testTagsConfirmed);

  const handleWebNfcWrite = async (alias: string, url: string) => {
    if (nfcBusyAlias || !canWriteTag) return;
    haptic('medium');
    setNfcBusyAlias(alias);
    if (isWebNfcSupported()) {
      setNfcFeedback({ ok: true, text: `请将 ${alias} 的贴纸放到手机 NFC 感应区…` });
    }
    const result = await writeUrlToNfcTag(url);
    setNfcBusyAlias(null);
    setNfcFeedback({
      ok: result.ok,
      text: result.ok && !result.copied ? '已写入，请移开标签后再贴近，完成读回校验。' : result.message,
    });
    haptic(result.ok ? 'success' : 'warning');
  };

  const handleNfcReadback = async (alias: string, expectedUrl: string) => {
    if (nfcBusyAlias || !canWriteTag || !adminToken.trim()) return;
    setNfcBusyAlias(alias);
    try {
      let readUrl: string | undefined;
      if (isWebNfcSupported()) {
        setNfcFeedback({ ok: true, text: `请贴近 ${alias} 的标签进行读回校验…` });
        const result = await readUrlFromNfcTag(expectedUrl);
        if (!result.ok) throw new Error(result.message);
        readUrl = result.url;
      } else {
        readUrl = window.prompt('把 NFC Tools 从同一张标签读出的唯一 URL 贴在这里。')?.trim();
        if (!readUrl) return;
      }
      if (readUrl !== expectedUrl) throw new Error(`标签地址不匹配。应为 ${expectedUrl}`);
      await api.markNfcTagWritten(adminToken.trim(), alias, readUrl, nfcScope);
      await loadAllAdminData(adminToken.trim());
      setNfcFeedback({ ok: true, text: `已校验 ${alias}。标签读回的 URL 与预期一致。` });
      haptic('success');
    } catch (err) {
      setNfcFeedback({ ok: false, text: err instanceof Error ? err.message : '标签读回校验失败' });
      haptic('warning');
    } finally {
      setNfcBusyAlias(null);
    }
  };

  const handleAddNfcTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken.trim() || !newAlias.trim() || !newAliasDollId) return;
    setError(null);
    try {
      const res = await api.upsertNfcTag(adminToken.trim(), {
        alias: newAlias.trim().toLowerCase(),
        dollId: newAliasDollId,
        label: newAliasLabel.trim() || undefined,
      });
      setNewAlias('');
      setNewAliasLabel('');
      haptic('success');
      setNotice(`已创建 NFC 短码映射：${res.nfcUrl}`);
      await loadAllAdminData(adminToken.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 NFC 短码失败');
    }
  };

  const buildNfcExportTxt = () => {
    if (!status) return '';
    const lines = [
      '# 果壳碰碰 · NFC Tools 写入链接清单',
      `# 工位访问地址：${status.settings.effectiveBaseUrl}`,
      '# 使用方式：在手机端打开 NFC Tools -> 写 -> 添加记录 -> URL/URI -> 粘贴下方链接 -> 写入 NTAG213/215 贴纸',
      '',
    ];
    for (const tag of status.nfcTags) {
      lines.push(`[${tag.personaMbti || 'NFC'}] ${tag.dollName} (${tag.alias}) -> ${tag.nfcUrl}`);
    }
    for (const d of status.dollsForNfc) {
      if (!status.nfcTags.some((t) => t.dollId === d.id)) {
        lines.push(`[${d.personaMbti}] ${d.name} (${d.kind}) -> ${d.directUrl}`);
      }
    }
    return lines.join('\n');
  };

  const buildNfcExportCsv = () => {
    if (!status) return '';
    const header = 'alias,doll_name,mbti,label,nfc_url,direct_url';
    const rows = status.nfcTags.map(
      (t) =>
        `"${t.alias}","${t.dollName.replace(/"/g, '""')}","${t.personaMbti}","${t.label.replace(/"/g, '""')}","${t.nfcUrl}","${t.directUrl}"`
    );
    return [header, ...rows].join('\n');
  };

  const handleAddMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken.trim() || !newMatLabel.trim() || !newMatMaterial.trim() || matBusy) return;
    setMatBusy(true);
    setError(null);
    try {
      await api.upsertMaterial(adminToken.trim(), {
        label: newMatLabel.trim(),
        category: newMatCategory,
        material: newMatMaterial.trim(),
        visualHint: newMatVisualHint.trim() || undefined,
        inStock: true,
      });
      setNewMatLabel('');
      setNewMatMaterial('');
      setNewMatVisualHint('');
      haptic('success');
      setNotice('已新增工坊材料。严格实材模式使用有参考图的可用材料。');
      await loadAllAdminData(adminToken.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增材料失败');
    } finally {
      setMatBusy(false);
    }
  };

  const handleToggleStock = async (mat: MaterialRecord) => {
    if (!adminToken.trim() || matBusy) return;
    setMatBusy(true);
    setError(null);
    try {
      await api.updateMaterial(adminToken.trim(), mat.id, { inStock: !mat.inStock });
      haptic('selection');
      await loadAllAdminData(adminToken.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换库存状态失败');
    } finally {
      setMatBusy(false);
    }
  };

  const handleDeleteMaterial = async (mat: MaterialRecord) => {
    if (!adminToken.trim() || matBusy) return;
    setMatBusy(true);
    setError(null);
    try {
      await api.deleteMaterial(adminToken.trim(), mat.id);
      haptic('warning');
      setNotice(`已删除材料「${mat.label}」`);
      await loadAllAdminData(adminToken.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除材料失败');
    } finally {
      setMatBusy(false);
    }
  };

  const handleImportMaterialsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setImportJsonText(text);
    } catch {
      setError('无法读取所选 JSON 文件');
    }
  };

  const handleSubmitMaterialsImport = async () => {
    if (!adminToken.trim() || !importJsonText.trim() || matBusy) return;
    setError(null);
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJsonText);
    } catch {
      setError('JSON 格式解析失败，请检查括号与引号是否正确。');
      return;
    }
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: Array<Record<string, unknown>> }).items
      : null;

    if (!items || items.length === 0) {
      setError('JSON 必须为材料对象数组（或包含 items 数组的对象）。');
      return;
    }

    setMatBusy(true);
    try {
      const res = await api.importMaterialsJson(
        adminToken.trim(),
        items as Array<Record<string, unknown>>,
        importMode
      );
      haptic('success');
      setNotice(`已成功导入 ${res.importedCount} 条材料（当前共 ${res.totalCount} 条）。`);
      setImportJsonText('');
      setShowImportPanel(false);
      await loadAllAdminData(adminToken.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量导入材料失败');
    } finally {
      setMatBusy(false);
    }
  };

  const handleResetSession = async (sessionId: string) => {
    if (!adminToken.trim() || resettingId) return;
    haptic('warning');
    setResettingId(sessionId);
    setNotice(null);
    setError(null);
    try {
      const res = await api.resetDemoSession(adminToken.trim(), sessionId);
      setNotice(`已清理会话 ${res.resetSessionId}；常驻角色与其他会话保持原状。`);
      const nextSess = await api.initSession();
      setCurrentSession(nextSess);
      await loadAllAdminData(adminToken.trim());
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : '重置会话失败');
      }
    } finally {
      setResettingId(null);
    }
  };

  return (
    <div className="max-w-[1160px] mx-auto px-3.5 sm:px-8 py-3 sm:py-6 space-y-3.5 sm:space-y-5">
      {/* Compact Admin Token Strip */}
      <form
        onSubmit={handleAuthSubmit}
        className="studio-card rounded-[18px] p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4"
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <ShieldCheck className="w-4 h-4 text-[#4A8276] shrink-0" />
          <input
            id="adminToken"
            type="password"
            aria-label="管理员令牌"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="输入服务端配置的管理令牌"
            className="flex-1 min-w-0 px-3 py-2 text-[16px] sm:text-xs font-mono text-[#382A22] placeholder:text-[#B3A497] bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#4A8276]/20 focus:border-[#4A8276]"
          />
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
          {currentSession && (
            <span className="text-[11px] font-mono text-[#9A887B] truncate max-w-[160px] sm:max-w-none">
              会话 {currentSession.sessionId}
            </span>
          )}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium btn-ink-tinted whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{status ? '刷新' : '验证进入'}</span>
          </button>
        </div>
      </form>

      {error && (
        <div className="p-3 rounded-xl border border-[#E5B8B0] bg-[#FDF2F0] text-xs text-[#9E3D2E]">
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-xl border border-[#4A8276]/35 bg-[#ECF5F2]/75 text-xs text-[#2B5D52]">
          {notice}
        </div>
      )}

      {status && (
        <div className="space-y-3.5 sm:space-y-4">
          {/* 5-Tab Console Segmented Bar */}
          <div
            role="tablist"
            aria-label="控制台视图"
            className="ios-segmented grid grid-cols-5 overflow-x-auto"
          >
            {(
              [
                { key: 'overview' as const, label: '模型与降级' },
                { key: 'nfc' as const, label: `NFC 工坊 (${status.nfcTags.length})` },
                { key: 'materials' as const, label: `材料库 (${status.counts.materialsInStock ?? materials.filter((m) => m.inStock).length})` },
                { key: 'sessions' as const, label: `会话 (${status.activeSessions.length})` },
                { key: 'logs' as const, label: '日志与记录' },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    haptic('selection');
                    setActiveTab(tab.key);
                  }}
                  className={`relative py-2 px-1.5 sm:px-2 text-[11px] sm:text-[12px] font-medium rounded-[10px] transition-colors whitespace-nowrap ${
                    active ? 'text-[#382A22]' : 'text-[#7D6C5F]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dev-tab-thumb"
                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                      className="absolute inset-0 ios-segmented-thumb"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            {/* TAB 1: OVERVIEW & RUNTIME SWITCHES */}
            {activeTab === 'overview' && (
              <motion.div
                key="dev-overview"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE_STUDIO }}
                className="space-y-3.5 sm:space-y-4"
              >
                {/* Live Runtime Control Deck */}
                <section className="studio-card rounded-[20px] p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2 border-b border-[#EFE7DC] pb-3">
                    <div className="flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-[#4A8276]" />
                      <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                        运行期切换与路演应急降级
                      </h2>
                    </div>
                    <span className="text-[11px] text-[#9A887B]">即时持久化生效，无需重启服务</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {/* Google Nano Tier Switch */}
                    <div className="p-3.5 rounded-2xl studio-inset space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#382A22]">
                          Google Nano 出图档位
                        </span>
                        <span className="text-[11px] font-mono text-[#4A8276]">
                          {status.settings.imageModel}
                        </span>
                      </div>
                      {!status.settings.imageGenerationEnabled && <p className="text-xs text-[#875220]">公开预览生图待开放</p>}
                      <label className="flex items-center gap-2 text-xs text-[#6E5C50]">
                        生图服务
                        <select
                          value={status.settings.imageVendor}
                          disabled={savingSettings}
                          onChange={(event) => void handleUpdateSettings({ imageVendor: event.target.value as ImageVendor }, '已更新生图服务')}
                          className="rounded-lg border border-[#E4DBCE] bg-[#FAF7F2] px-2 py-1"
                        >
                          <option value="openai">OpenAI GPT Image</option>
                          <option value="gemini">Google Nano Banana</option>
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            { tier: 'fast' as const, title: '快速', desc: '适合预览形象' },
                            { tier: 'hd' as const, title: 'Nano 2.1 高清精绘', desc: '1K 细节 · 精选出图' },
                          ] as const
                        ).map((opt) => {
                          const active = status.settings.imageModelTier === opt.tier;
                          return (
                            <button
                              key={opt.tier}
                              type="button"
                              disabled={savingSettings}
                              onClick={() =>
                                void handleUpdateSettings(
                                  { imageModelTier: opt.tier },
                                  `已切换 Google Nano 模型为「${opt.title}」`
                                )
                              }
                              className={`text-left p-2.5 rounded-xl border transition-all ${
                                active
                                  ? 'border-[#4A8276] bg-[#EAF5F1] text-[#26544A]'
                                  : 'border-[#E6DDD0] bg-[#FFFDF9] text-[#6E5C50] hover:border-[#CFC1AE]'
                              }`}
                            >
                              <div className="text-xs font-semibold">{opt.title}</div>
                              <div className="text-[10.5px] opacity-80 mt-0.5">{opt.desc}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Cloud / Mock Emergency Switches */}
                    <div className="p-3.5 rounded-2xl studio-inset space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#382A22]">
                          模型通道与实材约束
                        </span>
                        <span className="text-[11px] text-[#8E7C6E]">弱网/配额一键切兜底</span>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#5B4B41]">对话模型通道</span>
                          <div className="inline-flex rounded-lg border border-[#E4DBCE] bg-white p-0.5">
                            {(['cloud', 'mock'] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                disabled={savingSettings}
                                onClick={() =>
                                  void handleUpdateSettings(
                                    { chatProviderMode: m },
                                    `对话通道已切换为 ${m}`
                                  )
                                }
                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                                  status.settings.chatProviderMode === m
                                    ? 'bg-[#4A8276] text-white'
                                    : 'text-[#6E5C50]'
                                }`}
                              >
                                {m === 'cloud' ? '阶跃星辰 StepFun' : '本地演示'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#5B4B41]">生图模型通道</span>
                          <div className="inline-flex rounded-lg border border-[#E4DBCE] bg-white p-0.5">
                            {(['cloud', 'mock'] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                disabled={savingSettings}
                                onClick={() =>
                                  void handleUpdateSettings(
                                    { imageProviderMode: m },
                                    `生图通道已切换为 ${m}`
                                  )
                                }
                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                                  status.settings.imageProviderMode === m
                                    ? 'bg-[#4A8276] text-white'
                                    : 'text-[#6E5C50]'
                                }`}
                              >
                                {m === 'cloud' ? '云端 Nano' : '手帐模拟'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#ECE4D8]">
                          <span className="text-[#5B4B41]">严格在库实材约束（防不可复刻）</span>
                          <button
                            type="button"
                            disabled={savingSettings}
                            onClick={() =>
                              void handleUpdateSettings(
                                { strictMaterialConstraint: !status.settings.strictMaterialConstraint },
                                status.settings.strictMaterialConstraint
                                  ? '已放松材料约束为偏好模式'
                                  : '已开启严格在库手作材料约束'
                              )
                            }
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                              status.settings.strictMaterialConstraint
                                ? 'bg-[#EAF5F1] border-[#4A8276] text-[#26544A]'
                                : 'bg-[#FFFDF9] border-[#DCD2C4] text-[#8E7C6E]'
                            }`}
                          >
                            {status.settings.strictMaterialConstraint ? '已开启' : '已关闭'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* 3 Compact Provider Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                  <div className="studio-card rounded-[18px] p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#9A887B]">对话服务</span>
                      <span className="font-medium text-[#4A8276]">
                        {status.providers.chat.configured ? '已就绪' : '未配置密钥'}
                      </span>
                    </div>
                    <div className="font-editorial text-base font-semibold text-[#382A22]">
                      {status.providers.chat.mode === 'cloud' ? '阶跃星辰 StepFun (cloud)' : '本地演示 (mock)'}
                    </div>
                    <div className="text-[11px] font-mono text-[#6E5C50] flex items-center justify-between pt-2 border-t border-[#F0E9DF]">
                      <span className="truncate">{status.providers.chat.model}</span>
                      <span className="tabular-nums shrink-0">
                        目标 ≤{status.providers.chat.firstTokenTargetMs}ms
                      </span>
                    </div>
                  </div>

                  <div className="studio-card rounded-[18px] p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#9A887B]">Google Nano 生图</span>
                      <span className="font-medium text-[#4A8276]">
                        {status.providers.image.configured ? '已就绪' : '未配置密钥'}
                      </span>
                    </div>
                    <div className="font-editorial text-base font-semibold text-[#382A22]">
                      {status.providers.image.mode === 'cloud'
                        ? status.settings.imageModelTierLabel
                        : '本地手帐样张 (mock)'}
                    </div>
                    <div className="text-[11px] font-mono text-[#6E5C50] flex items-center justify-between pt-2 border-t border-[#F0E9DF]">
                      <span className="truncate">{status.providers.image.model}</span>
                      <span className="tabular-nums shrink-0">
                        ≤{status.providers.image.performanceTargetMs / 1000}s
                      </span>
                    </div>
                  </div>

                  <div className="studio-card rounded-[18px] p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#9A887B]">展位资产与材料</span>
                      <span className="font-mono text-[#6E5C50]">16 MBTI</span>
                    </div>
                    <div className="font-editorial text-base font-semibold text-[#382A22]">
                      常驻 {status.counts.demoDolls} · 个人 {status.counts.personalDolls} · 材料{' '}
                      {status.counts.materialsInStock ?? 0}/{status.counts.materialsTotal ?? 0}
                    </div>
                    <div className="text-[11px] font-mono text-[#9A887B] pt-2 border-t border-[#F0E9DF]">
                      卡片 {status.counts.cards} · NFC 标签 {status.nfcTags.length}
                    </div>
                  </div>
                </div>

                {/* Metrics Pair */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                  <div className="studio-card rounded-[18px] p-4 space-y-2.5">
                    <h2 className="font-editorial text-sm font-semibold text-[#382A22]">
                      对话性能统计
                    </h2>
                    {status.metrics.chat.length === 0 ? (
                      <p className="text-xs text-[#9A887B]">暂无对话记录。</p>
                    ) : (
                      <div className="divide-y divide-[#F0E9DF] text-xs font-mono">
                        {status.metrics.chat.map((m, idx) => (
                          <div key={idx} className="py-2 flex items-center justify-between gap-2">
                            <span className="text-[#382A22]">
                              {m.provider || '-'} · {m.status} ({m.cnt})
                            </span>
                            <span className="text-[#6E5C50] tabular-nums">
                              首字 {m.avg_ttft_ms != null ? `${Math.round(m.avg_ttft_ms)}ms` : '-'} / 总{' '}
                              {m.avg_total_ms != null ? `${Math.round(m.avg_total_ms)}ms` : '-'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="studio-card rounded-[18px] p-4 space-y-2.5">
                    <h2 className="font-editorial text-sm font-semibold text-[#382A22]">
                      生图与模板统计
                    </h2>
                    {status.metrics.image.length === 0 ? (
                      <p className="text-xs text-[#9A887B]">暂无生图或模板记录。</p>
                    ) : (
                      <div className="divide-y divide-[#F0E9DF] text-xs font-mono">
                        {status.metrics.image.map((m, idx) => (
                          <div key={idx} className="py-2 flex items-center justify-between gap-2">
                            <span className="text-[#382A22] truncate">
                              {m.provider} · {m.result_kind} ({m.cnt})
                            </span>
                            <span className="text-[#6E5C50] tabular-nums shrink-0">
                              {m.status} · {m.avg_ms != null ? `${(m.avg_ms / 1000).toFixed(1)}s` : '-'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* TAB 2: NFC WORKSHOP */}
            {activeTab === 'nfc' && (
              <motion.div
                key="dev-nfc"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE_STUDIO }}
                className="space-y-4"
              >
                {/* Booth Public Base URL Config */}
                <section className="studio-card rounded-[20px] p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                        工位公网 / 局域网访问域名配置
                      </h2>
                      <p className="text-xs text-[#8E7C6E] mt-0.5">
                        配置后，所有 NFC 写入链接与角色二维码将统一使用此地址（防止写入 localhost 导致手机打不开）。
                      </p>
                    </div>
                    <span className="text-[11px] font-mono text-[#4A8276]">
                      当前生效：{status.settings.effectiveBaseUrl}
                    </span>
                  </div>

                  {status.settings.nfcBaseUrlEditable && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleUpdateSettings(
                        { nfcPublicBaseUrl: nfcBaseUrlInput.trim() },
                        '已保存工位 NFC 域名，所有二维码与标签链接已刷新！'
                      );
                    }}
                    className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                  >
                    <input
                      type="text"
                      value={nfcBaseUrlInput}
                      onChange={(e) => setNfcBaseUrlInput(e.target.value)}
                      placeholder="https://nutshell.yourdomain.com"
                      className="flex-1 min-w-0 px-3 py-2 text-[14px] sm:text-xs font-mono bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:border-[#4A8276]"
                    />
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium btn-capsule-primary whitespace-nowrap"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>保存域名</span>
                    </button>
                  </form>
                  )}

                  <p className="text-xs text-[#6E5C50] break-all">{status.settings.effectiveBaseUrl}</p>
                  {nfcScope === 'unavailable' && (
                    <p className="text-xs text-[#875220]">配置正式 HTTPS 域名后可写入正式贴纸。</p>
                  )}
                  {nfcScope === 'test' && (
                    <label className="flex items-center gap-2 rounded-lg bg-[#FDF4E8] px-3 py-2 text-xs text-[#875220]">
                      <input type="checkbox" checked={testTagsConfirmed}
                        onChange={(event) => setTestTagsConfirmed(event.target.checked)} />
                      我使用的是单独的测试贴纸
                    </label>
                  )}
                </section>

                {/* iPhone (iOS) Dedicated NFC Write & Tap Guide */}
                <section className="studio-card rounded-[20px] p-4 sm:p-5 bg-[#FBF7F0]/90 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                      iPhone 苹果手机碰一碰与写签方案
                    </h2>
                    <span className="text-[11px] font-mono text-[#4A8276]">
                      读签：原生支持免 App · 写签：NFC Tools 3 步搞定
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-[#6B5A4E] leading-relaxed">
                    <div className="p-3 rounded-xl bg-white/80 border border-[#EAE0D2] space-y-1">
                      <div className="font-semibold text-[#382A22]">① 游客用 iPhone 碰一碰（原生支持）</div>
                      <p>
                        iPhone XS / XR 及以上无需下载 App，<strong>亮屏将手机顶部（听筒/摄像头附近）贴近娃娃贴纸</strong>，屏幕顶部即弹出 Safari 横幅，点一下直达唤醒并保留记忆（换浏览器可用 6 位记忆口令同步）。
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/80 border border-[#EAE0D2] space-y-1">
                      <div className="font-semibold text-[#382A22]">② 工作人员用 iPhone 写入贴纸</div>
                      <p>
                        因苹果 iOS 系统禁止所有浏览器网页直接写卡，请在 App Store 安装免费版 <strong>NFC Tools</strong>：
                        点下方任意娃娃的「复制」→ 打开 NFC Tools → <strong>写 → 添加记录 → URL/URI → 粘贴 → 写</strong>，iPhone 顶部贴贴纸 1 秒写完。
                      </p>
                    </div>
                  </div>
                </section>

                {/* Web NFC Tools & Batch Export */}
                <section className="studio-card rounded-[20px] p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFE7DC] pb-3">
                    <div>
                      <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                        NFC 贴纸直写与批量导出清单
                      </h2>
                      <p className="text-xs text-[#8E7C6E] mt-0.5">
                        写入一条 URL/URI 记录。写完后读回同一张贴纸，核对完整地址。
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!canWriteTag}
                        onClick={() => void handleCopyText('export_txt', buildNfcExportTxt())}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium btn-ink-tinted whitespace-nowrap"
                      >
                        {copiedKey === 'export_txt' ? (
                          <Check className="w-3.5 h-3.5 text-[#4A8276]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-[#4A8276]" />
                        )}
                        <span>{copiedKey === 'export_txt' ? '已复制清单' : '复制 NFC Tools 清单'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={!canWriteTag}
                        onClick={() =>
                          downloadTextFile(
                            'nutshell_nfc_links.csv',
                            buildNfcExportCsv(),
                            'text/csv;charset=utf-8'
                          )
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium btn-paper-soft whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>导出 CSV</span>
                      </button>
                    </div>
                  </div>

                  {nfcFeedback && (
                    <div
                      className={`p-3 rounded-xl text-xs border ${
                        nfcFeedback.ok
                          ? 'border-[#C1E0D6] bg-[#ECF7F3] text-[#2A5A4F]'
                          : 'border-[#E5B8B0] bg-[#FDF2F0] text-[#9E3D2E]'
                      }`}
                    >
                      {nfcFeedback.text}
                    </div>
                  )}

                  {/* NFC Tag Rows */}
                  <div className="divide-y divide-[#EFE7DC]">
                    {status.nfcTags.map((tag) => (
                      <div
                        key={tag.alias}
                        className="py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-[#E8F4F0] text-[#2D6458] font-mono text-[11px] font-semibold">
                              /nfc/{tag.alias}
                            </span>
                            <span className="font-editorial text-sm font-semibold text-[#382A22]">
                              {tag.dollName}
                            </span>
                            <span className="text-[11px] font-mono text-[#8E7C6E]">
                              {tag.personaMbti} · {tag.personaName}
                            </span>
                            {tag.lastWrittenAt && (
                              <span className="text-[10.5px] text-[#4A8276]">
                                已校验 {new Date(tag.lastWrittenAt).toLocaleTimeString('zh-CN', { hour12: false })}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-[#6E5C50] break-all">
                            {tag.nfcUrl}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={!canWriteTag || Boolean(nfcBusyAlias)}
                            onClick={() => void handleWebNfcWrite(tag.alias, tag.nfcUrl)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium btn-ink-tinted whitespace-nowrap"
                          >
                            <Radio className="w-3.5 h-3.5 text-[#4A8276]" />
                            <span>
                              {nfcBusyAlias === tag.alias
                                ? '贴近中…'
                                : isIosDevice()
                                ? '复制给 NFC Tools'
                                : '写入标签'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleNfcReadback(tag.alias, tag.nfcUrl)}
                            disabled={!canWriteTag || Boolean(nfcBusyAlias)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium btn-paper-soft whitespace-nowrap"
                          >
                            <span>{isWebNfcSupported() ? '读回校验' : '核对读回地址'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={!canWriteTag}
                            onClick={() => void handleCopyText(tag.alias, tag.nfcUrl)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium btn-paper-soft whitespace-nowrap"
                          >
                            {copiedKey === tag.alias ? (
                              <Check className="w-3.5 h-3.5 text-[#4A8276]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedKey === tag.alias ? '已复制' : '复制'}</span>
                          </button>
                          <a
                            href={`/nfc/${encodeURIComponent(tag.alias)}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium btn-icon-ghost whitespace-nowrap"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-[#4A8276]" />
                            <span>打开 NFC 链接</span>
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Bind New Short Alias Form */}
                  <form
                    onSubmit={handleAddNfcTag}
                    className="pt-3.5 border-t border-[#EFE7DC] grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                  >
                    <input
                      type="text"
                      value={newAlias}
                      onChange={(e) => setNewAlias(e.target.value)}
                      placeholder="新短码（如 booth05）"
                      className="sm:col-span-3 px-3 py-2 text-xs font-mono bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:border-[#4A8276]"
                    />
                    <select
                      value={newAliasDollId}
                      onChange={(e) => setNewAliasDollId(e.target.value)}
                      className="sm:col-span-4 px-3 py-2 text-xs bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:border-[#4A8276]"
                    >
                      {status.dollsForNfc.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.personaMbti} · {d.kind === 'demo' ? '常驻' : '个人'})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={newAliasLabel}
                      onChange={(e) => setNewAliasLabel(e.target.value)}
                      placeholder="备注（可选，如 2号展台贴纸）"
                      className="sm:col-span-3 px-3 py-2 text-xs bg-[#FAF7F2] border border-[#E4DBCE] rounded-xl focus:outline-none focus:bg-white focus:border-[#4A8276]"
                    />
                    <button
                      type="submit"
                      disabled={!newAlias.trim() || !newAliasDollId}
                      className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium btn-ink-tinted whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>绑定短码</span>
                    </button>
                  </form>
                </section>
              </motion.div>
            )}

            {/* TAB 3: CONFIGURABLE CRAFT MATERIALS INVENTORY */}
            {activeTab === 'materials' && (
              <motion.div
                key="dev-materials"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE_STUDIO }}
                className="space-y-4"
              >
                <section className="studio-card rounded-[20px] p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFE7DC] pb-3">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-[#4A8276]" />
                      <div>
                        <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                          工坊真实材料库（在库 {materials.filter((m) => m.inStock).length} / 共 {materials.length}）
                        </h2>
                        <p className="text-xs text-[#8E7C6E]">
                          严格实材模式使用有参考图的在库材料。材料清单支持 JSON 导入。
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowImportPanel((v) => !v)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium btn-ink-tinted whitespace-nowrap"
                      >
                        <Upload className="w-3.5 h-3.5 text-[#4A8276]" />
                        <span>{showImportPanel ? '收起 JSON 导入' : '批量导入 JSON'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={!canWriteTag}
                        onClick={() =>
                          downloadTextFile(
                            'nutshell_materials_export.json',
                            JSON.stringify(materials, null, 2),
                            'application/json;charset=utf-8'
                          )
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium btn-paper-soft whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>导出当前 JSON</span>
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Bulk JSON Import Panel */}
                  <AnimatePresence initial={false}>
                    {showImportPanel && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-3.5 rounded-2xl bg-[#FAF6F0] border border-[#E6DDD0] space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-[#382A22]">
                              导入团队真实材料清单（JSON）
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setImportJsonText(JSON.stringify(SAMPLE_IMPORT_TEMPLATE, null, 2))
                                }
                                className="text-[11px] text-[#4A8276] hover:underline"
                              >
                                填入示例模板
                              </button>
                              <label className="text-[11px] font-medium text-[#382A22] px-2.5 py-1 rounded-lg bg-white border border-[#E4DBCE] cursor-pointer hover:border-[#4A8276]">
                                选择 .json 文件
                                <input
                                  type="file"
                                  accept="application/json,.json"
                                  onChange={handleImportMaterialsFile}
                                  className="sr-only"
                                />
                              </label>
                            </div>
                          </div>

                          <textarea
                            rows={6}
                            value={importJsonText}
                            onChange={(e) => setImportJsonText(e.target.value)}
                            placeholder='粘贴材料 JSON 数组，每项包含 label、material、category、visualHint、inStock'
                            className="w-full p-3 text-xs font-mono bg-white border border-[#E4DBCE] rounded-xl focus:outline-none focus:border-[#4A8276]"
                          />

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-3 text-xs text-[#6E5C50]">
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name="importMode"
                                  checked={importMode === 'merge'}
                                  onChange={() => setImportMode('merge')}
                                />
                                <span>合并更新（保留已有）</span>
                              </label>
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name="importMode"
                                  checked={importMode === 'replace'}
                                  onChange={() => setImportMode('replace')}
                                />
                                <span>全量覆盖替换</span>
                              </label>
                            </div>
                            <button
                              type="button"
                              disabled={matBusy || !importJsonText.trim()}
                              onClick={() => void handleSubmitMaterialsImport()}
                              className="px-4 py-1.5 text-xs font-medium btn-capsule-primary"
                            >
                              {matBusy ? '导入中…' : '确认导入材料库'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Inline Add Single Material Form */}
                  <form
                    onSubmit={handleAddMaterial}
                    className="p-3.5 rounded-2xl studio-inset grid grid-cols-1 sm:grid-cols-12 gap-2"
                  >
                    <input
                      type="text"
                      value={newMatLabel}
                      onChange={(e) => setNewMatLabel(e.target.value)}
                      placeholder="材料名称（如 迷你松果帽）"
                      className="sm:col-span-3 px-3 py-2 text-xs bg-white border border-[#E4DBCE] rounded-xl focus:outline-none focus:border-[#4A8276]"
                    />
                    <select
                      value={newMatCategory}
                      onChange={(e) => setNewMatCategory(e.target.value as MaterialCategory)}
                      className="sm:col-span-2 px-2.5 py-2 text-xs bg-white border border-[#E4DBCE] rounded-xl focus:outline-none focus:border-[#4A8276]"
                    >
                      {(Object.keys(CATEGORY_LABELS) as MaterialCategory[]).map((cat) => (
                        <option key={cat} value={cat}>
                          {CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={newMatMaterial}
                      onChange={(e) => setNewMatMaterial(e.target.value)}
                      placeholder="材质说明（如 天然风干松果）"
                      className="sm:col-span-2 px-3 py-2 text-xs bg-white border border-[#E4DBCE] rounded-xl focus:outline-none focus:border-[#4A8276]"
                    />
                    <input
                      type="text"
                      value={newMatVisualHint}
                      onChange={(e) => setNewMatVisualHint(e.target.value)}
                      placeholder="英文画面描述 visualHint（可选，供 Nano 生图用）"
                      className="sm:col-span-3 px-3 py-2 text-xs bg-white border border-[#E4DBCE] rounded-xl focus:outline-none focus:border-[#4A8276]"
                    />
                    <button
                      type="submit"
                      disabled={matBusy || !newMatLabel.trim() || !newMatMaterial.trim()}
                      className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium btn-ink-tinted whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新增材料</span>
                    </button>
                  </form>

                  {/* Materials Table */}
                  <div className="divide-y divide-[#EFE7DC]">
                    {materials.map((m) => (
                      <div
                        key={m.id}
                        className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[#382A22]">{m.label}</span>
                            <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-[#F6F1E8] text-[#7A685B]">
                              {CATEGORY_LABELS[m.category] || m.category}
                            </span>
                            <span className="text-[11px] text-[#6E5C50]">{m.material}</span>
                          </div>
                          <div className="text-[11px] font-mono text-[#9A887B] truncate">
                            {m.id} · {m.visualHint}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={matBusy}
                            onClick={() => void handleToggleStock(m)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                              m.inStock
                                ? 'bg-[#EAF5F1] border-[#4A8276] text-[#26544A]'
                                : 'bg-[#FAF6F0] border-[#DCD2C4] text-[#9A887B]'
                            }`}
                          >
                            {m.inStock ? '在库可用' : '暂缺停用'}
                          </button>
                          <button
                            type="button"
                            disabled={matBusy}
                            onClick={() => void handleDeleteMaterial(m)}
                            aria-label={`删除 ${m.label}`}
                            className="p-1.5 text-[#A49386] hover:text-[#B84A39] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </motion.div>
            )}

            {/* TAB 4: ACTIVE SESSIONS */}
            {activeTab === 'sessions' && (
              <motion.section
                key="dev-sessions"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE_STUDIO }}
                className="studio-card rounded-[18px] p-4 sm:p-5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                    活跃会话管理
                  </h2>
                  <span className="text-[11px] text-[#9A887B]">仅清理指定演示会话</span>
                </div>

                {status.activeSessions.length === 0 ? (
                  <p className="text-xs text-[#9A887B]">当前无活跃会话。</p>
                ) : (
                  <div className="divide-y divide-[#EAE2D6]">
                    {status.activeSessions.map((s) => {
                      const isCurrent = currentSession?.sessionId === s.id;
                      const runningCount = s.running_versions + s.running_jobs;
                      return (
                        <div
                          key={s.id}
                          className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[#382A22] truncate">{s.id}</span>
                              {isCurrent && (
                                <span className="text-[11px] font-medium text-[#4A8276] shrink-0">
                                  本浏览器
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-[#6E5C50]">
                              卡片 {s.card_count} · 娃娃 {s.personal_doll_count} · 消息{' '}
                              {s.message_count} ·{' '}
                              {runningCount > 0 ? (
                                <span className="text-[#B84A39]">{runningCount} 运行中</span>
                              ) : (
                                <span className="text-[#9A887B]">空闲</span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleResetSession(s.id)}
                            disabled={resettingId !== null}
                            className="self-end sm:self-auto inline-flex items-center gap-1.5 text-xs font-medium btn-icon-ghost whitespace-nowrap"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-[#4A8276]" />
                            <span>{resettingId === s.id ? '重置中…' : '重置会话'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.section>
            )}

            {/* TAB 5: RUN LOGS & AI-NATIVE DEV RECORD */}
            {activeTab === 'logs' && (
              <motion.div
                key="dev-logs"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE_STUDIO }}
                className="space-y-4"
              >
                {/* AI Native Dev Showcase Card for Competition Judges */}
                <section className="studio-card rounded-[18px] p-4 sm:p-5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                      AI Native 架构与路演核验清单
                    </h2>
                    <span className="text-[11px] font-mono text-[#4A8276]">NutShell Bump v1.2</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                    <div className="p-3 rounded-xl studio-inset space-y-1">
                      <div className="font-semibold text-[#382A22]">1. 碰一碰与跨端记忆</div>
                      <p className="text-[11px] text-[#6E5C50] leading-relaxed">
                        支持 /nfc/:alias 短链、Web NFC 直写与读回、Cookie + VisitorKey 双轨续聊及 6 位记忆口令跨浏览器同步。
                      </p>
                    </div>
                    <div className="p-3 rounded-xl studio-inset space-y-1">
                      <div className="font-semibold text-[#382A22]">2. 16 型 MBTI 深度区分</div>
                      <p className="text-[11px] text-[#6E5C50] leading-relaxed">
                        16 个角色各有说话风格与材料搭配。情景题按固定规则计分，照片分析提供配色参考。
                      </p>
                    </div>
                    <div className="p-3 rounded-xl studio-inset space-y-1">
                      <div className="font-semibold text-[#382A22]">3. Google Nano × 实材库</div>
                      <p className="text-[11px] text-[#6E5C50] leading-relaxed">
                        生图请求使用创建任务时选定的服务、模型和材料约束。
                      </p>
                    </div>
                  </div>
                </section>

                <section className="studio-card rounded-[18px] p-4 sm:p-5 space-y-3">
                  <h2 className="font-editorial text-base font-semibold text-[#382A22]">
                    近期运行记录 ({status.recentRuns.length})
                  </h2>

                  {status.recentRuns.length === 0 ? (
                    <p className="text-xs text-[#9A887B]">暂无运行日志。</p>
                  ) : (
                    <div className="divide-y divide-[#EAE2D6]">
                      {status.recentRuns.slice(0, 15).map((log) => (
                        <div key={log.id} className="py-2.5 space-y-1 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[#382A22] truncate">
                              {log.kind} / {log.provider}
                              {log.result_kind ? ` (${log.result_kind})` : ''}
                            </span>
                            <span
                              className={`font-medium shrink-0 ${
                                log.status === 'failed' ? 'text-[#B84A39]' : 'text-[#4A8276]'
                              }`}
                            >
                              {log.status}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#9A887B] tabular-nums">
                            <span>
                              {new Date(log.created_at).toLocaleTimeString('zh-CN', {
                                hour12: false,
                              })}
                            </span>
                            <span>
                              {log.first_token_ms != null ? `${log.first_token_ms}ms / ` : ''}
                              {log.total_ms != null ? `${log.total_ms}ms` : '-'}
                            </span>
                          </div>
                          {(log.error_code || log.detail) && (
                            <div className="text-[11px] text-[#6E5C50] line-clamp-2">
                              {log.error_code ? `[${log.error_code}] ` : ''}
                              {log.detail || ''}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
