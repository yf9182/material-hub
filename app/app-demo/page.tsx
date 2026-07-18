"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type CategoryNode = { id: string; name: string; code: string; children?: CategoryNode[] };
type Property = { value?: unknown[]; data?: { cdn_url?: string; id?: string; name?: string; size?: number } };
type MaterialRecord = { id: string; material_id: string; public_properties?: Record<string, Property>; independent_properties?: Record<string, Property>; publish_status?: number };
type ApiResponse<T> = { code: number; msg?: string; data: T };

const endpointBase = "/api/v1";
const contextQuery = "pid=8801&channel=English&source=English&page=1&page_size=100";

function property(item: MaterialRecord, section: "public_properties" | "independent_properties", key: string) {
  return item[section]?.[key] ?? {};
}

function configOf(item: MaterialRecord) {
  const raw = property(item, "public_properties", "material_config").value?.[0];
  try { return typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { return {}; }
}

function mediaOf(item: MaterialRecord) {
  const config = configOf(item);
  const type = Number(config.type ?? 0);
  const thumbnail = property(item, "independent_properties", "thumbnail_file_id").data?.cdn_url ?? "";
  const original = property(item, "public_properties", "original_file_id").data?.cdn_url ?? "";
  const preview = property(item, "independent_properties", "video_preview_file_id").data?.cdn_url ?? "";
  const fileUrl = property(item, "public_properties", "file_url").data?.cdn_url ?? String(property(item, "public_properties", "file_url").value?.[0] ?? "");
  return { type, thumbnail, original, preview, back: fileUrl || original, config };
}

function titleOf(item: MaterialRecord) {
  const lang = property(item, "independent_properties", "material_lang").data?.lang as Record<string, { content?: string }> | undefined;
  return lang?.en?.content || lang?.["zh-cn"]?.content || item.material_id;
}

async function apiGet<T>(path: string, key: string) {
  const response = await fetch(path, { headers: { "x-api-key": key } });
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || payload.code !== 1) throw new Error(payload.msg || "API 请求失败");
  return payload.data;
}

export default function AppDemoPage() {
  const [apiKey, setApiKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [root, setRoot] = useState<CategoryNode | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryNode | null>(null);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [lastRequest, setLastRequest] = useState("等待连接 API");
  const [detailLoading, setDetailLoading] = useState(false);

  const activeIndex = useMemo(() => root?.children?.findIndex((item) => item.id === selectedCategory?.id) ?? 0, [root, selectedCategory]);

  async function loadCategory(category: CategoryNode, key = apiKey) {
    if (!key) { setError("请先输入 API Key"); return; }
    setSelectedCategory(category); setSelectedMaterial(null); setLoading(true); setError("");
    const path = `${endpointBase}/product-material/category-group/list?${contextQuery}&product_material_category_ids=${encodeURIComponent(category.id)}`;
    setLastRequest(`GET ${path}`);
    try {
      const data = await apiGet<{ group: { list: MaterialRecord[] }[] }>(path, key);
      setMaterials(data.group?.[0]?.list ?? []); setConnected(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "素材加载失败"); setMaterials([]); }
    finally { setLoading(false); }
  }

  async function connect(nextKey = apiKey) {
    if (!nextKey.trim()) { setError("请输入 API Key"); return; }
    setLoading(true); setError(""); setApiKey(nextKey.trim());
    localStorage.setItem("material-demo-key", nextKey.trim());
    const path = `${endpointBase}/product-material-category/ids/tree-list?${contextQuery}`;
    setLastRequest(`GET ${path}`);
    try {
      const data = await apiGet<{ list: CategoryNode[] }>(path, nextKey.trim());
      const nextRoot = data.list?.[0] ?? null; setRoot(nextRoot); setConnected(true);
      if (nextRoot?.children?.[0]) await loadCategory(nextRoot.children[0], nextKey.trim());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分类加载失败"); setConnected(false); }
    finally { setLoading(false); }
  }

  async function openMaterial(item: MaterialRecord) {
    setSelectedMaterial(item); setDetailLoading(true);
    if (!selectedCategory) return;
    const path = `${endpointBase}/product-material/category-group/${selectedCategory.id}?${contextQuery}`;
    setLastRequest(`GET ${path}`);
    try {
      const data = await apiGet<{ list: MaterialRecord[] }>(path, apiKey);
      const fresh = data.list?.find((entry) => entry.material_id === item.material_id); if (fresh) setSelectedMaterial(fresh);
    } catch { /* keep the list response available in the detail view */ }
    finally { setDetailLoading(false); }
  }

  useEffect(() => {
    const saved = localStorage.getItem("material-demo-key");
    fetch("/api/demo/key").then((response) => response.ok ? response.json() as Promise<{ apiKey?: string }> : null).then((data) => { const key = data?.apiKey || saved; if (key) connect(key); }).catch(() => { if (saved) connect(saved); });
    // connect is intentionally triggered only once for the local demo session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <main className="app-demo-shell">
    <header className="app-demo-header"><Link className="demo-brand" href="/admin"><b>MH</b><span><strong>Material Hub</strong><small>客户端效果预览</small></span></Link><div className="demo-header-center"><span className="demo-overline">APP EXPERIENCE LAB</span><strong>8801 · English</strong></div><div className="demo-header-actions"><span className={connected ? "api-status online" : "api-status"}><i/>{connected ? "API 已连接" : "未连接"}</span><Link href="/admin" className="demo-admin-link">返回后台 ↗</Link></div></header>
    <section className="demo-hero"><div><span className="demo-kicker">REAL API / MATERIAL EXPERIENCE</span><h1>把素材接口，<br/><em>变成真正的客户端体验。</em></h1><p>这是一个面向 App 的调用示例。分类、封面、媒体类型和详情都来自当前素材 API。</p><div className="demo-hero-actions"><a href="#catalog" className="demo-primary">浏览 Nano Banana <span>↓</span></a><span className="demo-note">实时读取 · API Key 鉴权</span></div></div><div className="demo-hero-card"><span className="hero-card-label">LIVE CATALOG</span><strong>{root?.name || "Nano Banana"}</strong><div className="hero-metrics"><span><b>{root?.children?.length ?? 7}</b><small>二级分类</small></span><span><b>{materials.length || 240}</b><small>当前素材</small></span><span><b>API</b><small>在线数据</small></span></div><div className="hero-wave"><i/><i/><i/><i/><i/><i/><i/><i/></div></div></section>
    <section className="demo-connect"><div><span className="section-label">CONNECTION</span><strong>用客户端的方式验证 API</strong><small>演示 Key 仅用于当前本地预览，可在后台随时撤销。</small></div><div className="key-entry"><input aria-label="API Key" type={keyVisible ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") connect(); }} placeholder="mat_••••••••••••••••"/><button className="key-toggle" onClick={() => setKeyVisible((value) => !value)}>{keyVisible ? "隐藏" : "显示"}</button><button className="connect-button" onClick={() => connect()} disabled={loading}>{loading ? "连接中…" : connected ? "重新连接" : "连接 API"}</button></div></section>
    <section className="demo-workspace" id="catalog"><aside className="demo-category-nav"><div className="demo-nav-title"><span className="section-label">CATEGORIES</span><strong>Nano Banana</strong><small>{root?.children?.length ?? 7} 个二级分类</small></div><div className="demo-category-list">{root?.children?.map((category, index) => <button className={selectedCategory?.id === category.id ? "active" : ""} key={category.id} onClick={() => loadCategory(category)}><span className="category-number">{String(index + 1).padStart(2, "0")}</span><span>{category.name}</span><b>{selectedCategory?.id === category.id ? "→" : ""}</b></button>) ?? <div className="demo-empty">连接后加载分类</div>}</div><div className="demo-nav-foot"><span className="pulse-dot"/>公开 API · Key Auth<small>category-tree + material-group</small></div></aside><div className="demo-content"><div className="demo-content-head"><div><span className="section-label">MATERIALS / {String(activeIndex + 1).padStart(2, "0")}</span><h2>{selectedCategory?.name || "选择一个分类"}</h2><p>{selectedCategory ? "素材由 category-group/list 返回，点击卡片查看单分类详情接口。" : "连接 API 后选择左侧二级分类。"}</p></div><div className="demo-result-meta"><span>{loading ? "读取中…" : `${materials.length} 条素材`}</span><span className="result-dot"/></div></div>{error && <div className="demo-error"><b>API 返回错误</b><span>{error}</span><button onClick={() => connect()}>重试</button></div>}<div className="demo-material-grid">{materials.map((item) => <MaterialCard key={item.material_id} item={item} onClick={() => openMaterial(item)}/>)}{!loading && selectedCategory && !materials.length && !error && <div className="demo-empty-grid">该分类暂无已发布素材</div>}{loading && <>{[1,2,3,4,5,6].map((item) => <div className="demo-skeleton" key={item}/>)}</>}</div><div className="demo-api-strip"><span><i className="method-get">GET</i> category-group/list</span><span>分页 1 / 100</span><span>公开响应 · {lastRequest.includes("category-group/") ? "单分类详情" : "多分类素材"}</span></div></div></section>
    {selectedMaterial && <MaterialDetail item={selectedMaterial} loading={detailLoading} onClose={() => setSelectedMaterial(null)}/>}<footer className="app-demo-footer"><span>Material Hub · App Experience Lab</span><span>公共字段：thumbnail_file_id / video_preview_file_id / original_file_id</span></footer>
  </main>;
}

function MaterialCard({ item, onClick }: { item: MaterialRecord; onClick: () => void }) {
  const media = mediaOf(item); const title = titleOf(item); const typeLabel = media.type === 1 ? "前后图" : media.type === 2 ? "单图" : "视频";
  if (media.type === 1) return <button className="demo-material-card comparison-card" onClick={onClick}><div className="comparison-image" style={media.thumbnail ? { backgroundImage: `url(${media.thumbnail})` } : undefined}><span>前图</span></div><div className="comparison-image" style={media.back ? { backgroundImage: `url(${media.back})` } : undefined}><span>后图</span></div><CardOverlay title={title} typeLabel={typeLabel}/></button>;
  const cover = media.thumbnail || media.preview;
  return <button className="demo-material-card" onClick={onClick}><div className="demo-card-image" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>{!cover && <span className="cover-placeholder">{title.slice(0, 1)}</span>}{media.type !== 2 && <span className="play-badge">▶</span>}<span className="media-chip">{typeLabel}</span></div><div className="demo-card-copy"><strong>{title}</strong><span>{item.material_id.slice(0, 12)} · API material</span></div></button>;
}

function CardOverlay({ title, typeLabel }: { title: string; typeLabel: string }) { return <div className="comparison-overlay"><span className="media-chip">{typeLabel}</span><strong>{title}</strong><small>前后图对比 · API material</small></div>; }

function MaterialDetail({ item, loading, onClose }: { item: MaterialRecord; loading: boolean; onClose: () => void }) {
  const media = mediaOf(item); const config = JSON.stringify(media.config, null, 2); const title = titleOf(item); const mediaRows = [{ label: "thumbnail_file_id", value: media.thumbnail }, { label: "original_file_id", value: media.original }, { label: "video_preview_file_id", value: media.preview }];
  return <div className="demo-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="demo-detail" role="dialog" aria-modal="true"><header><div><span className="section-label">SINGLE CATEGORY API</span><h2>{title}</h2><small>{loading ? "正在读取最新详情…" : "GET /category-group/{categoryId}"}</small></div><button onClick={onClose} aria-label="关闭详情">×</button></header><div className="detail-preview" style={media.thumbnail ? { backgroundImage: `linear-gradient(180deg, transparent 35%, #0a0c17ee), url(${media.thumbnail})` } : undefined}><div><span>type = {media.type || "nil"}</span><strong>{media.type === 1 ? "前后图对比" : media.type === 2 ? "单独一张图" : "视频 / 其他类型"}</strong></div></div><div className="detail-fields"><div><span className="section-label">MEDIA REFERENCES</span>{mediaRows.map((row) => <p key={row.label}><code>{row.label}</code><a href={row.value || "#"} target="_blank" rel="noreferrer">{row.value ? "查看文件 ↗" : "未配置"}</a></p>)}</div><div><span className="section-label">MATERIAL CONFIG</span><pre>{config}</pre></div></div><footer><span>ID · {item.material_id}</span><button onClick={onClose}>返回素材</button></footer></aside></div>;
}
