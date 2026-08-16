"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { clearDashboardSnapshot, loadDashboardSnapshot, saveDashboardSnapshot } from "../lib/dashboard/storage";
import { normalizeWorkOrders, type RawWorkOrder, type WorkOrder } from "../lib/nucleus/normalize";
import { getNucleusStatusTone } from "../lib/nucleus/status";

type ExtractionPayload = {
  orders?: RawWorkOrder[];
  pagesProcessed?: number;
  totalPages?: number;
  stagesProcessed?: number;
  stageErrors?: number;
  metrics?: { durationMs?: number; statusCacheHits?: number; statusRequests?: number; pagesSavedByIncremental?: number; newOrders?: number };
  error?: string;
};

type ProductionStatsPayload = {
  totalCm2?: number;
  extractedAt?: string;
  error?: string;
};

type DashboardSortKey = "id" | "client" | "work" | "technology" | "createdAt" | "status";
type SortDirection = "asc" | "desc";
type ExtractionSource = "all" | "active" | "closed";

const getDashboardSortValue = (order: WorkOrder, key: DashboardSortKey) => {
  if (key === "id") return Number(order.id);
  if (key === "createdAt") return order.createdAt.split(" às ")[0].split("/").reverse().join("-");
  if (key === "status") return order.isClosed ? "Encerrado" : order.status;
  return order[key];
};

const workerUrl = process.env.NEXT_PUBLIC_NUCLEUS_WORKER_URL || "/api/nucleus";
const formatTime = (date: Date) => date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const formatExtractionMetrics = (metrics?: ExtractionPayload["metrics"]) => metrics
  ? ` · ${((metrics.durationMs ?? 0) / 1000).toFixed(1)}s · ${metrics.statusCacheHits ?? 0} status em cache`
  : "";
const formatSquareMeters = (squareCentimeters: number) => (squareCentimeters / 10_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toDateInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = new Date();
const PAGE_SIZE = 25;
const SESSION_KEY = "studio-laser-dashboard-session";
const NUCLEUS_COMPANIES = [
  { id: "17110", label: "CETI" }, { id: "63864", label: "DELTABAG" }, { id: "17214", label: "EPEMA" },
  { id: "31227", label: "LIRAFLEX" }, { id: "21599", label: "MECCAPLAST" }, { id: "60428", label: "OI" },
  { id: "50416", label: "OLP" }, { id: "17546", label: "PACKSEVEN" }, { id: "58826", label: "PACKWEL" },
  { id: "58853", label: "PLASTLOG" }, { id: "32046", label: "POLYPLASTIC" }, { id: "31328", label: "PRIMEFLEX" },
  { id: "17589", label: "PULIT" }, { id: "64495", label: "REA" }, { id: "21419", label: "RELIPEL" },
  { id: "17615", label: "RIACHO" }, { id: "31277", label: "SIDPLASTIC" }, { id: "20658", label: "SOLPP" },
  { id: "17720", label: "TODER" }, { id: "21520", label: "ZARAPLAST" },
];
const currentMonth = {
  from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
  to: toDateInput(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
};

export const dynamic = "force-dynamic";

export default function Home() {
  const initialSnapshot = useMemo(() => loadDashboardSnapshot(), []);
  const navigation = typeof window !== "undefined" ? performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined : undefined;
  const isReload = navigation?.type === "reload";
  const hasActiveSession = !isReload && typeof window !== "undefined" && window.sessionStorage.getItem(SESSION_KEY) === "authenticated";
  const [authenticated, setAuthenticated] = useState(hasActiveSession);
  const [email, setEmail] = useState(() => initialSnapshot?.email ?? "");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [orders, setOrders] = useState(() => hasActiveSession ? initialSnapshot?.orders ?? normalizeWorkOrders([]) : normalizeWorkOrders([]));
  const [tab, setTab] = useState<"active" | "closed">("active");
  const [query, setQuery] = useState("");
  const [client, setClient] = useState("Todos os clientes");
  const [dateFrom, setDateFrom] = useState(hasActiveSession ? initialSnapshot?.dateFrom ?? currentMonth.from : currentMonth.from);
  const [dateTo, setDateTo] = useState(hasActiveSession ? initialSnapshot?.dateTo ?? currentMonth.to : currentMonth.to);
  const [draftDateFrom, setDraftDateFrom] = useState(hasActiveSession ? initialSnapshot?.dateFrom ?? currentMonth.from : currentMonth.from);
  const [draftDateTo, setDraftDateTo] = useState(hasActiveSession ? initialSnapshot?.dateTo ?? currentMonth.to : currentMonth.to);
  const [draftClientId, setDraftClientId] = useState("");
  const [refreshModalOpen, setRefreshModalOpen] = useState(false);
  const [dateError, setDateError] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos os status");
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(() => hasActiveSession && initialSnapshot?.lastSync ? new Date(initialSnapshot.lastSync) : null);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [totalCm2, setTotalCm2] = useState<number | null>(() => hasActiveSession && typeof initialSnapshot?.totalCm2 === "number" ? initialSnapshot.totalCm2 : null);
  const [cm2Loading, setCm2Loading] = useState(false);
  const [cm2Error, setCm2Error] = useState("");
  const [cm2LastSync, setCm2LastSync] = useState<Date | null>(() => hasActiveSession && initialSnapshot?.totalCm2UpdatedAt ? new Date(initialSnapshot.totalCm2UpdatedAt) : null);
  const [sortKey, setSortKey] = useState<DashboardSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const [showMobileInsights, setShowMobileInsights] = useState(false);
  const [syncPartial, setSyncPartial] = useState(false);

  const persistDashboardSnapshot = (nextOrders: typeof orders, nextDateFrom: string, nextDateTo: string, nextEmail: string, nextTotalCm2 = totalCm2) => {
    saveDashboardSnapshot({ orders: nextOrders, dateFrom: nextDateFrom, dateTo: nextDateTo, email: nextEmail, lastSync: new Date().toISOString(), totalCm2: nextTotalCm2 ?? undefined, totalCm2UpdatedAt: cm2LastSync?.toISOString() });
  };

  const ordersInPeriod = useMemo(() => orders.filter((order) => {
    const orderDate = order.createdAt.split(" às ")[0].split("/").reverse().join("-");
    return (!dateFrom || orderDate >= dateFrom) && (!dateTo || orderDate <= dateTo);
  }), [dateFrom, dateTo, orders]);
  const clients = useMemo(() => Array.from(new Set(ordersInPeriod.map((order) => order.client))).sort(), [ordersInPeriod]);
  const statuses = useMemo(() => Array.from(new Set(ordersInPeriod.filter((order) => !order.isClosed).map((order) => order.status))).filter(Boolean).sort(), [ordersInPeriod]);
  const toggleSort = (nextKey: DashboardSortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  };

  const sortIndicator = (key: DashboardSortKey) => sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : "↕";
  const filteredOrders = useMemo(() => ordersInPeriod.filter((order) => {
    const matchesTab = tab === "closed" ? order.isClosed : !order.isClosed;
    const haystack = `${order.id} ${order.client} ${order.name} ${order.work}`.toLowerCase();
    return matchesTab && haystack.includes(query.toLowerCase()) &&
      (client === "Todos os clientes" || order.client === client) &&
      (tab !== "active" || statusFilter === "Todos os status" || order.status === statusFilter);
  }).sort((left, right) => {
    const leftValue = getDashboardSortValue(left, sortKey);
    const rightValue = getDashboardSortValue(right, sortKey);
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), "pt-BR", { numeric: true, sensitivity: "base" });
    return sortDirection === "asc" ? comparison : -comparison;
  }), [client, ordersInPeriod, query, sortDirection, sortKey, statusFilter, tab]);
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pageKey = `${client}|${dateFrom}|${dateTo}|${query}|${sortDirection}|${sortKey}|${statusFilter}|${tab}|${orders.length}`;
  const currentPage = pagination.key === pageKey ? Math.min(pagination.page, totalPages) : 1;
  const setCurrentPage = (nextPage: number | ((page: number) => number)) => {
    setPagination((current) => {
      const page = current.key === pageKey ? current.page : 1;
      return { key: pageKey, page: typeof nextPage === "function" ? nextPage(page) : nextPage };
    });
  };
  const visibleOrders = filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function extractOrders(requestDateFrom = dateFrom, requestDateTo = dateTo, requestClientId?: string, requestUserId?: string, source: ExtractionSource = "all") {
    const clientId = requestClientId !== undefined ? requestClientId : orders.find((order) => order.client === client)?.clientId;
    let response: Response;
    try {
      response = await fetch(`${workerUrl}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, filters: { clientId, userId: requestUserId, dateFrom: requestDateFrom, dateTo: requestDateTo, source } }),
      });
    } catch {
      throw new Error("Não foi possível conectar ao serviço de sincronização.");
    }
    const payload = await response.json() as ExtractionPayload;
    if (!response.ok) {
      if (payload.error?.includes("authentication failed")) throw new Error("E-mail ou senha inválidos no Nucleus.");
      if (payload.error?.includes("session expired")) throw new Error("A sessão do Nucleus expirou. Entre novamente.");
      throw new Error(payload.error || "Não foi possível extrair os trabalhos do Nucleus.");
    }
    return payload;
  }

  async function refreshProductionStats(requestEmail = email, requestPassword = password) {
    setCm2Loading(true);
    setCm2Error("");
    try {
      const response = await fetch(`${workerUrl}/production-stats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPassword ? { email: requestEmail, password: requestPassword } : {}),
      });
      const payload = await response.json() as ProductionStatsPayload;
      if (!response.ok || typeof payload.totalCm2 !== "number") {
        throw new Error(payload.error || "Não foi possível extrair o total de cm².");
      }
      const updatedAt = payload.extractedAt ? new Date(payload.extractedAt) : new Date();
      setTotalCm2(payload.totalCm2);
      setCm2LastSync(updatedAt);
      const savedSnapshot = loadDashboardSnapshot();
      if (savedSnapshot) {
        saveDashboardSnapshot({ ...savedSnapshot, totalCm2: payload.totalCm2, totalCm2UpdatedAt: updatedAt.toISOString() });
      }
    } catch (error) {
      setCm2Error(error instanceof Error ? error.message : "Falha ao atualizar o total de cm².");
    } finally {
      setCm2Loading(false);
    }
  }

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || password.length < 4) {
      setLoginError("Informe o e-mail e a senha reais do Nucleus.");
      return;
    }
    setLoginLoading(true);
    setLoginError("");
    try {
      const payload = await extractOrders(dateFrom, dateTo);
      const nextOrders = normalizeWorkOrders(payload.orders ?? []);
      setOrders(nextOrders);
      setLastSync(new Date());
      persistDashboardSnapshot(nextOrders, dateFrom, dateTo, email);
      setNotice(`Sincronização concluída: ${payload.orders?.length ?? 0} trabalhos em ${payload.pagesProcessed ?? 0} páginas e ${payload.stagesProcessed ?? 0} etapas consultadas${payload.stageErrors ? ` (${payload.stageErrors} indisponíveis)` : ""}${formatExtractionMetrics(payload.metrics)}.`);
      setNoticeError(false);
      setSyncPartial(Boolean(payload.stageErrors));
      setAuthenticated(true);
      window.sessionStorage.setItem(SESSION_KEY, "authenticated");
      void refreshProductionStats();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Não foi possível entrar no Nucleus.");
    } finally {
      setLoginLoading(false);
    }
  };

  const refresh = async (requestDateFrom: string, requestDateTo: string, requestClientId?: string, requestUserId?: string, source: ExtractionSource = "all") => {
    setRefreshing(true);
    setNotice("");
    try {
      const payload = await extractOrders(requestDateFrom, requestDateTo, requestClientId, requestUserId, source);
      const extractedOrders = normalizeWorkOrders(payload.orders ?? []);
      const preservedOrders = source === "active"
        ? orders.filter((order) => order.isClosed)
        : source === "closed"
          ? orders.filter((order) => !order.isClosed)
          : [];
      const nextOrders = [...preservedOrders, ...extractedOrders];
      setOrders(nextOrders);
      setDateFrom(requestDateFrom);
      setDateTo(requestDateTo);
      setClient(requestClientId
        ? NUCLEUS_COMPANIES.find((option) => option.id === requestClientId)?.label
          ?? nextOrders.find((order) => order.clientId === requestClientId)?.client
          ?? "Todos os clientes"
        : "Todos os clientes");
      setLastSync(new Date());
      persistDashboardSnapshot(nextOrders, requestDateFrom, requestDateTo, email);
       setNotice(`Dados atualizados: ${payload.orders?.length ?? 0} trabalhos em ${payload.pagesProcessed ?? 0} páginas e ${payload.stagesProcessed ?? 0} etapas consultadas${payload.stageErrors ? ` (${payload.stageErrors} indisponíveis)` : ""}${formatExtractionMetrics(payload.metrics)}.`);
      setNoticeError(false);
      setSyncPartial(Boolean(payload.stageErrors));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao atualizar os dados.");
      setNoticeError(true);
    } finally {
      setRefreshing(false);
    }
  };

  const openRefreshModal = () => {
    setDraftDateFrom(dateFrom);
    setDraftDateTo(dateTo);
    setDraftClientId(client === "Todos os clientes" ? "" : orders.find((order) => order.client === client)?.clientId ?? "");
    setDateError("");
    setRefreshModalOpen(true);
  };

  const confirmRefresh = async (source: ExtractionSource) => {
    if (!draftDateFrom || !draftDateTo) {
      setDateError("Informe a data inicial e a data final.");
      return;
    }
    if (draftDateFrom > draftDateTo) {
      setDateError("A data inicial não pode ser posterior à data final.");
      return;
    }
    setRefreshModalOpen(false);
    await refresh(draftDateFrom, draftDateTo, draftClientId || undefined, undefined, source);
  };

  const logout = () => {
    setAuthenticated(false);
    window.sessionStorage.removeItem(SESSION_KEY);
    setPassword("");
    setOrders(normalizeWorkOrders([]));
    setNotice("");
    setTotalCm2(null);
    setCm2Error("");
    setCm2LastSync(null);
    setSyncPartial(false);
    clearDashboardSnapshot();
  };

  if (!authenticated) {
    return <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-content">
          <div className="auth-brand"><div className="brand-mark"><span>SL</span></div><div><strong>Studio Laser</strong><small>Operações</small></div></div>
          <div className="eyebrow">ACESSO AO WORKSPACE</div>
          <h1>Central de trabalhos</h1>
          <p className="auth-subtitle">Entre com sua conta do Nucleus para carregar a visão operacional da Studio Laser.</p>
          <form onSubmit={submitLogin} className="auth-form">
            <label htmlFor="email">E-mail do Nucleus</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@studiolaser.com.br" autoComplete="username" disabled={loginLoading} />
            <label htmlFor="password">Senha</label>
            <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Digite sua senha" autoComplete="current-password" disabled={loginLoading} />
            {loginError && <p className="form-error">{loginError}</p>}
            <button className="primary-button auth-button" type="submit" disabled={loginLoading}>{loginLoading ? "Entrando e carregando todas as páginas..." : "Entrar e carregar dados"}<span>{loginLoading ? "↻" : "→"}</span></button>
          </form>
          <p className="security-note"><span className="lock-dot">●</span> As credenciais ficam somente na memória desta sessão.</p>
        </div>
      </section>
      <aside className="auth-aside"><div className="aside-grid" /><div className="auth-aside-copy"><p className="aside-kicker">PAINEL OPERACIONAL</p><h2>Produção,<br />sem ruído.</h2><p>Ordens, etapas e volume produtivo em uma única visão.</p></div><div className="auth-preview" aria-hidden="true"><div className="auth-preview-top"><span /><span /></div><div className="auth-preview-stats"><i /><i /><i /></div><div className="auth-preview-body"><span /><span /><span /><span /></div></div><div className="aside-footer"><span className="status-pulse" /> Sincronização sob demanda</div></aside>
    </main>;
  }

  const scopedOrders = client === "Todos os clientes" ? ordersInPeriod : ordersInPeriod.filter((order) => order.client === client);
  const activeCount = scopedOrders.filter((order) => !order.isClosed).length;
  const closedCount = scopedOrders.filter((order) => order.isClosed).length;
  const waitingCount = scopedOrders.filter((order) => !order.isClosed && order.status.toLowerCase().includes("aguardando")).length;
  const activeOrders = scopedOrders.filter((order) => !order.isClosed);
  const clientBreakdown = Array.from(activeOrders.reduce((counts, order) => {
    counts.set(order.client, (counts.get(order.client) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()).sort((left, right) => right[1] - left[1]).slice(0, 5);
  const maxClientCount = clientBreakdown[0]?.[1] ?? 1;
  const allStageBreakdown = Array.from(activeOrders.reduce((counts, order) => {
    const stage = order.status || "Sem etapa informada";
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()).sort((left, right) => right[1] - left[1]);
  const topStages = allStageBreakdown.slice(0, 3);
  const otherStageCount = allStageBreakdown.slice(3).reduce((total, [, count]) => total + count, 0);
  const stageColors = ["var(--accent)", "var(--blue)", "var(--amber)"];
  let stageCursor = 0;
  const stageSlices = topStages.map(([, count], index) => {
    const start = stageCursor;
    stageCursor += activeCount ? (count / activeCount) * 100 : 0;
    return `${stageColors[index]} ${start}% ${stageCursor}%`;
  });
  if (stageCursor < 100) stageSlices.push(`#52616e ${stageCursor}% 100%`);
  const stageChartBackground = activeCount ? `conic-gradient(${stageSlices.join(",")})` : "#26323c";
  const clearFilters = () => {
    setQuery("");
    setClient("Todos os clientes");
    setStatusFilter("Todos os status");
  };
  const hasFilters = Boolean(query) || client !== "Todos os clientes" || statusFilter !== "Todos os status";

  return <main className="app-shell" aria-busy={refreshing}>
    <div className="app-interface" inert={refreshing ? true : undefined} aria-hidden={refreshing || undefined}>
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark small"><span>SL</span></div><div><strong>Studio Laser</strong><small>Operações</small></div></div>
        <nav className="main-nav" aria-label="Navegação principal"><button className="nav-item active" type="button" aria-current="page"><span>◆</span> Visão geral</button><a href="/relatorios" className="nav-item"><span>◇</span> Relatórios</a></nav>
        <div className="sidebar-bottom">
          <div className={`connection ${syncPartial ? "partial" : ""}`}><span className="status-pulse" /><div><strong>{syncPartial ? "Dados parciais" : "Dados carregados"}</strong><small>{ordersInPeriod.length} ordens no período · {lastSync ? `atualizado às ${formatTime(lastSync)}` : "aguardando atualização"}</small></div></div>
          <button className="user-row" onClick={logout}><span className="avatar">{email.slice(0, 1).toUpperCase()}</span><span><strong>{email.split("@")[0]}</strong><small>Sair da conta</small></span><span className="more">•••</span></button>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Visão geral</strong></div><div className="topbar-actions"><span className="last-sync"><b className={`freshness-dot ${syncPartial ? "partial" : ""}`} />{syncPartial ? "Atualização parcial" : "Dados atualizados"} <strong>{lastSync ? formatTime(lastSync) : "—"}</strong></span><div className="top-avatar">{email.slice(0, 1).toUpperCase()}</div></div></header>
        <div className="content">
          <div className="page-heading"><div><div className="eyebrow">STUDIO LASER / NUCLEUS</div><h1>Visão operacional</h1><p>{dateFrom.split("-").reverse().join("/")} — {dateTo.split("-").reverse().join("/")} · {client}</p></div><div className="page-actions"><a href="/relatorios" className="secondary-action"><span>↓</span> Relatório</a><button className={`refresh-button ${refreshing ? "is-refreshing" : ""}`} onClick={openRefreshModal} disabled={refreshing}><span>↻</span>{refreshing ? "Sincronizando..." : "Atualizar dados"}</button></div></div>
          {notice && <div className={`notice ${noticeError ? "error" : syncPartial ? "partial" : ""}`} role="status" aria-live="polite"><span>{noticeError ? "!" : syncPartial ? "◷" : "✓"}</span>{notice}</div>}
          <div className="stats-grid frost-stats">
            <article className="stat-card"><div className="stat-label">Em andamento <span className="stat-icon green">↗</span></div><strong>{activeCount}</strong><small>Ordens ativas no período</small></article>
            <article className="stat-card attention-card"><div className="stat-label">Aguardando <span className="stat-icon amber">!</span></div><strong>{waitingCount}</strong><small>Requerem acompanhamento</small></article>
            <article className="stat-card"><div className="stat-label">Encerradas <span className="stat-icon blue">✓</span></div><strong>{closedCount}</strong><small>Concluídas no período</small></article>
            <article className="stat-card production-card"><div className="stat-label">Produção do usuário <button className={`card-refresh ${cm2Loading ? "is-refreshing" : ""}`} type="button" onClick={() => void refreshProductionStats()} disabled={cm2Loading} aria-label="Atualizar produção do usuário" title="Atualizar produção do usuário"><span>↻</span></button></div><strong className="cm2-value">{cm2Loading && totalCm2 === null ? "—" : totalCm2 === null ? "—" : formatSquareMeters(totalCm2)}{totalCm2 !== null && <em> m²</em>}</strong><small className={cm2Error ? "metric-error" : ""}>{cm2Error ? cm2Error : cm2LastSync ? `Nucleus · atualizado às ${formatTime(cm2LastSync)}` : totalCm2 !== null ? "Valor salvo do Nucleus" : password ? "Carregando produção..." : "Entre novamente para atualizar"}</small></article>
          </div>

          <button className="mobile-insights-toggle" type="button" onClick={() => setShowMobileInsights((visible) => !visible)} aria-expanded={showMobileInsights} aria-controls="dashboard-insights">{showMobileInsights ? "Ocultar indicadores" : "Ver indicadores por cliente e etapa"}<span>{showMobileInsights ? "↑" : "↓"}</span></button>
          <section className={`insights-grid ${showMobileInsights ? "mobile-expanded" : ""}`} id="dashboard-insights" aria-label="Indicadores operacionais">
            <article className="insight-panel"><div className="insight-heading"><div><h2>Ordens por cliente</h2><p>Volume de ordens ativas no período</p></div><span>Top 5</span></div>{clientBreakdown.length ? <div className="client-bars">{clientBreakdown.map(([clientName, count]) => <button type="button" className="client-bar-row" key={clientName} onClick={() => { setClient(clientName); setTab("active"); }} aria-label={`Filtrar ${count} ordens de ${clientName}`}><span className="client-name">{clientName}</span><span className="bar-track"><i style={{ width: `${Math.max(8, (count / maxClientCount) * 100)}%` }} /></span><strong>{count}</strong></button>)}</div> : <div className="insight-empty">Sincronize dados para ver os principais clientes.</div>}</article>
            <article className="insight-panel"><div className="insight-heading"><div><h2>Distribuição por etapa</h2><p>Top 3 entre {activeCount} ordens ativas</p></div></div>{activeCount ? <div className="stage-layout"><div className="stage-donut" style={{ background: stageChartBackground }} role="img" aria-label={`Distribuição das ${activeCount} ordens ativas pelas principais etapas`}><span><strong>{activeCount}</strong><small>ativas</small></span></div><div className="stage-legend">{topStages.map(([stage, count], index) => <button type="button" key={stage} title={stage} onClick={() => { setStatusFilter(stage); setTab("active"); }}><i style={{ background: stageColors[index] }} /><span>{stage}</span><strong>{count}</strong></button>)}{otherStageCount > 0 && <div><i className="other-stage" /><span>Outras {Math.max(0, allStageBreakdown.length - 3)} etapas</span><strong>{otherStageCount}</strong></div>}</div></div> : <div className="insight-empty">Nenhuma ordem ativa no período.</div>}</article>
          </section>

          <section className="orders-section" data-tab={tab}>
            <div className="section-heading"><div><h2>Ordens de serviço</h2><p>Dados sincronizados do Nucleus.</p></div>{hasFilters && <button type="button" className="clear-filters" onClick={clearFilters}>Limpar filtros</button>}</div>
            <div className="tabs" role="tablist"><button className={tab === "active" ? "selected" : ""} onClick={() => setTab("active")} role="tab" aria-selected={tab === "active"}>Em andamento <span>{activeCount}</span></button><button className={tab === "closed" ? "selected" : ""} onClick={() => setTab("closed")} role="tab" aria-selected={tab === "closed"}>Encerradas <span>{closedCount}</span></button></div>
            <div className="filters"><div className="search-wrap"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, nome ou número..." aria-label="Buscar ordens" /></div><select value={client} onChange={(event) => setClient(event.target.value)} aria-label="Filtrar cliente"><option>Todos os clientes</option>{clients.map((item) => <option key={item}>{item}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar etapa"><option>Todos os status</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></div>
            {hasFilters && <div className="active-filter-chips" aria-label="Filtros ativos">{query && <button onClick={() => setQuery("")}>Busca: {query} <span>×</span></button>}{client !== "Todos os clientes" && <button onClick={() => setClient("Todos os clientes")}>{client} <span>×</span></button>}{statusFilter !== "Todos os status" && <button onClick={() => setStatusFilter("Todos os status")}>{statusFilter} <span>×</span></button>}</div>}
            {tab === "active" && <div className="table-wrap active-orders-table"><table><thead><tr><th><button className="table-sort-button" onClick={() => toggleSort("id")}>Ordem <span>{sortIndicator("id")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("client")}>Cliente / nome <span>{sortIndicator("client")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("createdAt")}>Criado em <span>{sortIndicator("createdAt")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("status")}>Etapa <span>{sortIndicator("status")}</span></button></th></tr></thead><tbody>{visibleOrders.map((order, index) => <tr key={`${order.id}-${order.work}-${index}`}><td><strong className="order-id">#{order.id}</strong><small>v{order.version} · pedido {order.order}</small></td><td><strong>{order.client}</strong><span>{order.name}</span></td><td><strong>{order.createdAt.split(" às ")[0]}</strong><span>{order.createdAt.split(" às ")[1]}</span></td><td><span className={`status-pill nucleus-status-${getNucleusStatusTone(order.status, order.isClosed)}`}><i />{order.status}</span></td></tr>)}</tbody></table>{visibleOrders.length === 0 && <div className="empty-state"><strong>Nenhuma ordem encontrada</strong><span>Ajuste os filtros ou atualize os dados.</span>{hasFilters && <button type="button" onClick={clearFilters}>Limpar filtros</button>}</div>}</div>}
            {tab === "closed" && <div className="table-wrap closed-orders-table"><table><thead><tr><th><button className="table-sort-button" onClick={() => toggleSort("id")}>Ordem <span>{sortIndicator("id")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("client")}>Cliente / nome <span>{sortIndicator("client")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("createdAt")}>Criado em <span>{sortIndicator("createdAt")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("status")}>Etapa <span>{sortIndicator("status")}</span></button></th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={`${order.id}-${order.work}`}><td><strong className="order-id">#{order.id}</strong><small>v{order.version} · pedido {order.order}</small></td><td><strong>{order.client}</strong><span>{order.name}</span></td><td><strong>{order.createdAt.split(" às ")[0]}</strong><span>{order.createdAt.split(" às ")[1]}</span></td><td><span className={`status-pill nucleus-status-${getNucleusStatusTone(order.status, order.isClosed)}`}><i />Encerrada</span></td></tr>)}</tbody></table>{visibleOrders.length === 0 && <div className="empty-state"><strong>Nenhuma ordem encontrada</strong><span>Ajuste os filtros ou atualize os dados.</span>{hasFilters && <button type="button" onClick={clearFilters}>Limpar filtros</button>}</div>}</div>}
            <div className="mobile-order-list">{visibleOrders.map((order) => <article className="mobile-order-card" key={`mobile-${order.id}-${order.work}`}><div className="mobile-order-top"><strong className="order-id">#{order.id}</strong><span className={`status-pill nucleus-status-${getNucleusStatusTone(order.status, order.isClosed)}`}><i />{order.isClosed ? "Encerrada" : order.status}</span></div><h3>{order.client}</h3><p>{order.name}</p><dl><div><dt>Criada em</dt><dd>{order.createdAt}</dd></div></dl><small>v{order.version} · pedido {order.order}</small></article>)}{visibleOrders.length === 0 && <div className="empty-state"><strong>Nenhuma ordem encontrada</strong><span>Ajuste os filtros ou atualize os dados.</span>{hasFilters && <button type="button" onClick={clearFilters}>Limpar filtros</button>}</div>}</div>
            <div className="table-footer"><span>Mostrando <strong>{visibleOrders.length}</strong> de <strong>{filteredOrders.length}</strong> ordens</span><div className="pagination" aria-label="Paginação das ordens"><button type="button" onClick={() => setCurrentPage((page) => page - 1)} disabled={currentPage === 1} aria-label="Página anterior">‹</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => <button type="button" key={page} className={page === currentPage ? "current" : ""} onClick={() => setCurrentPage(page)} aria-label={`Página ${page}`} aria-current={page === currentPage ? "page" : undefined}>{page}</button>)}<button type="button" onClick={() => setCurrentPage((page) => page + 1)} disabled={currentPage === totalPages} aria-label="Próxima página">›</button></div></div>
          </section>
        </div>
      </section>
      <nav className="mobile-bottom-nav" aria-label="Navegação mobile"><Link href="/" aria-current="page"><span>◆</span>Visão geral</Link><Link href="/relatorios"><span>◇</span>Relatórios</Link><button type="button" onClick={logout}><span>●</span>Conta</button></nav>
         {refreshModalOpen && <div className="modal-backdrop"><section className="date-modal" role="dialog" aria-modal="true" aria-labelledby="refresh-modal-title"><div className="modal-header"><div><div className="eyebrow">SINCRONIZAÇÃO DO NUCLEUS</div><h2 id="refresh-modal-title">Atualizar dados</h2></div><button className="modal-close" onClick={() => setRefreshModalOpen(false)} aria-label="Fechar">×</button></div><p>Selecione a data inicial, a data final e o cliente para limitar a extração.</p><div className="modal-date-grid"><label>Data inicial<input type="date" value={draftDateFrom} onChange={(event) => { setDraftDateFrom(event.target.value); setDateError(""); }} /></label><span>até</span><label>Data final<input type="date" value={draftDateTo} onChange={(event) => { setDraftDateTo(event.target.value); setDateError(""); }} /></label></div><label className="modal-client-field">Cliente<select value={draftClientId} onChange={(event) => setDraftClientId(event.target.value)}><option value="">Todos os clientes</option>{NUCLEUS_COMPANIES.map((company) => <option key={company.id} value={company.id}>{company.label}</option>)}</select></label>{dateError && <p className="form-error modal-error">{dateError}</p>}<div className="modal-actions"><button className="secondary-button" onClick={() => setRefreshModalOpen(false)}>Cancelar</button><button className="primary-button" onClick={() => confirmRefresh("all")}>Atualizar dados</button></div></section></div>}
    </div>
    {refreshing && <div className="sync-lock" role="status" aria-live="assertive" aria-label="Sincronização em andamento">
      <section className="sync-lock-card">
        <span className="sync-spinner" aria-hidden="true" />
        <div className="eyebrow">SINCRONIZAÇÃO EM ANDAMENTO</div>
        <h2>Atualizando os trabalhos</h2>
        <p>Consultando todas as páginas do Nucleus. Aguarde até a conclusão.</p>
        <div className="sync-progress"><span /></div>
      </section>
    </div>}
  </main>;
}
