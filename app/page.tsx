"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { clearDashboardSnapshot, loadDashboardSnapshot, saveDashboardSnapshot } from "../lib/dashboard/storage";
import { normalizeWorkOrders, type RawWorkOrder, type WorkOrder } from "../lib/nucleus/normalize";
import { getNucleusStatusTone } from "../lib/nucleus/status";

type ExtractionPayload = {
  orders?: RawWorkOrder[];
  pagesProcessed?: number;
  totalPages?: number;
  stagesProcessed?: number;
  stageErrors?: number;
  error?: string;
};

type ProductionStatsPayload = {
  totalCm2?: number;
  extractedAt?: string;
  error?: string;
};

type ClientsPayload = {
  clients?: Array<{ id: string; label: string }>;
};

type DashboardSortKey = "id" | "client" | "work" | "technology" | "type" | "createdAt" | "status";
type SortDirection = "asc" | "desc";

const getDashboardSortValue = (order: WorkOrder, key: DashboardSortKey) => {
  if (key === "id") return Number(order.id);
  if (key === "createdAt") return order.createdAt.split(" às ")[0].split("/").reverse().join("-");
  if (key === "status") return order.isClosed ? "Encerrado" : order.status;
  return order[key];
};

const workerUrl = process.env.NEXT_PUBLIC_NUCLEUS_WORKER_URL || "/api/nucleus";
const formatTime = (date: Date) => date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const formatSquareMeters = (squareCentimeters: number) => (squareCentimeters / 10_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toDateInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = new Date();
const PAGE_SIZE = 25;
const currentMonth = {
  from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
  to: toDateInput(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
};

export const dynamic = "force-dynamic";

export default function Home() {
  const initialSnapshot = useMemo(() => loadDashboardSnapshot(), []);
  const [authenticated, setAuthenticated] = useState(() => Boolean(initialSnapshot?.email));
  const [email, setEmail] = useState(() => initialSnapshot?.email ?? "");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [orders, setOrders] = useState(() => initialSnapshot?.orders ?? normalizeWorkOrders([]));
  const [tab, setTab] = useState<"active" | "closed">("active");
  const [query, setQuery] = useState("");
  const [client, setClient] = useState("Todos os clientes");
  const [dateFrom, setDateFrom] = useState(initialSnapshot?.dateFrom ?? currentMonth.from);
  const [dateTo, setDateTo] = useState(initialSnapshot?.dateTo ?? currentMonth.to);
  const [draftDateFrom, setDraftDateFrom] = useState(initialSnapshot?.dateFrom ?? currentMonth.from);
  const [draftDateTo, setDraftDateTo] = useState(initialSnapshot?.dateTo ?? currentMonth.to);
  const [draftClientId, setDraftClientId] = useState("");
  const [availableClients, setAvailableClients] = useState<Array<{ id: string; label: string }>>([]);
  const [refreshModalOpen, setRefreshModalOpen] = useState(false);
  const [dateError, setDateError] = useState("");
  const [technology, setTechnology] = useState("Todas as tecnologias");
  const [type, setType] = useState("Todos os tipos");
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(() => initialSnapshot?.lastSync ? new Date(initialSnapshot.lastSync) : null);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [totalCm2, setTotalCm2] = useState<number | null>(() => typeof initialSnapshot?.totalCm2 === "number" ? initialSnapshot.totalCm2 : null);
  const [cm2Loading, setCm2Loading] = useState(false);
  const [cm2Error, setCm2Error] = useState("");
  const [cm2LastSync, setCm2LastSync] = useState<Date | null>(() => initialSnapshot?.totalCm2UpdatedAt ? new Date(initialSnapshot.totalCm2UpdatedAt) : null);
  const [sortKey, setSortKey] = useState<DashboardSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  const persistDashboardSnapshot = (nextOrders: typeof orders, nextDateFrom: string, nextDateTo: string, nextEmail: string, nextTotalCm2 = totalCm2) => {
    saveDashboardSnapshot({ orders: nextOrders, dateFrom: nextDateFrom, dateTo: nextDateTo, email: nextEmail, lastSync: new Date().toISOString(), totalCm2: nextTotalCm2 ?? undefined, totalCm2UpdatedAt: cm2LastSync?.toISOString() });
  };

  const clients = useMemo(() => Array.from(new Set(orders.map((order) => order.client))).sort(), [orders]);
  const technologies = useMemo(() => Array.from(new Set(orders.map((order) => order.technology))).sort(), [orders]);
  const types = useMemo(() => Array.from(new Set(orders.map((order) => order.type))).sort(), [orders]);
  const derivedClientOptions = useMemo(() => Array.from(new Map(orders.filter((order) => order.clientId).map((order) => [order.clientId as string, order.client])).entries()).map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label, "pt-BR")), [orders]);
  const clientOptions = availableClients.length > 0 ? availableClients : derivedClientOptions;
  const toggleSort = (nextKey: DashboardSortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  };

  const sortIndicator = (key: DashboardSortKey) => sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : "↕";
  const filteredOrders = useMemo(() => orders.filter((order) => {
    const matchesTab = tab === "closed" ? order.isClosed : !order.isClosed;
    const haystack = `${order.id} ${order.client} ${order.name} ${order.work}`.toLowerCase();
    const orderDate = order.createdAt.split(" às ")[0].split("/").reverse().join("-");
    return matchesTab && haystack.includes(query.toLowerCase()) &&
      (client === "Todos os clientes" || order.client === client) &&
      (!dateFrom || orderDate >= dateFrom) && (!dateTo || orderDate <= dateTo) &&
      (technology === "Todas as tecnologias" || order.technology === technology) &&
      (type === "Todos os tipos" || order.type === type);
  }).sort((left, right) => {
    const leftValue = getDashboardSortValue(left, sortKey);
    const rightValue = getDashboardSortValue(right, sortKey);
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), "pt-BR", { numeric: true, sensitivity: "base" });
    return sortDirection === "asc" ? comparison : -comparison;
  }), [client, dateFrom, dateTo, orders, query, sortDirection, sortKey, tab, technology, type]);
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const visibleOrders = filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [client, dateFrom, dateTo, orders, query, sortDirection, sortKey, tab, technology, type]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  async function extractOrders(requestDateFrom = dateFrom, requestDateTo = dateTo, requestClientId?: string) {
    const clientId = requestClientId !== undefined ? requestClientId : orders.find((order) => order.client === client)?.clientId;
    let response: Response;
    try {
      response = await fetch(`${workerUrl}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, filters: { clientId, dateFrom: requestDateFrom, dateTo: requestDateTo } }),
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

  async function loadClients() {
    try {
      const response = await fetch(`${workerUrl}/clients`, { cache: "no-store" });
      const payload = await response.json() as ClientsPayload;
      if (response.ok && payload.clients?.length) setAvailableClients(payload.clients);
    } catch {
      // The already extracted client list remains available as a fallback.
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
      const payload = await extractOrders();
      const nextOrders = normalizeWorkOrders(payload.orders ?? []);
      setOrders(nextOrders);
      setLastSync(new Date());
      persistDashboardSnapshot(nextOrders, dateFrom, dateTo, email);
      setNotice(`Sincronização concluída: ${payload.orders?.length ?? 0} trabalhos em ${payload.pagesProcessed ?? 0} páginas e ${payload.stagesProcessed ?? 0} etapas consultadas${payload.stageErrors ? ` (${payload.stageErrors} indisponíveis)` : ""}.`);
      setNoticeError(false);
      setAuthenticated(true);
      void refreshProductionStats();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Não foi possível entrar no Nucleus.");
    } finally {
      setLoginLoading(false);
    }
  };

  const refresh = async (requestDateFrom: string, requestDateTo: string, requestClientId?: string) => {
    setRefreshing(true);
    setNotice("");
    try {
      const payload = await extractOrders(requestDateFrom, requestDateTo, requestClientId);
      const nextOrders = normalizeWorkOrders(payload.orders ?? []);
      setOrders(nextOrders);
      setDateFrom(requestDateFrom);
      setDateTo(requestDateTo);
      setLastSync(new Date());
      persistDashboardSnapshot(nextOrders, requestDateFrom, requestDateTo, email);
      setNotice(`Dados atualizados: ${payload.orders?.length ?? 0} trabalhos em ${payload.pagesProcessed ?? 0} páginas e ${payload.stagesProcessed ?? 0} etapas consultadas${payload.stageErrors ? ` (${payload.stageErrors} indisponíveis)` : ""}.`);
      setNoticeError(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao atualizar os dados.");
      setNoticeError(true);
    } finally {
      setRefreshing(false);
    }
  };

  const openRefreshModal = () => {
    void loadClients();
    setDraftDateFrom(dateFrom);
    setDraftDateTo(dateTo);
    setDraftClientId(client === "Todos os clientes" ? "" : orders.find((order) => order.client === client)?.clientId ?? "");
    setDateError("");
    setRefreshModalOpen(true);
  };

  const confirmRefresh = async () => {
    if (!draftDateFrom || !draftDateTo) {
      setDateError("Informe a data inicial e a data final.");
      return;
    }
    if (draftDateFrom > draftDateTo) {
      setDateError("A data inicial não pode ser posterior à data final.");
      return;
    }
    setRefreshModalOpen(false);
    await refresh(draftDateFrom, draftDateTo, draftClientId || undefined);
  };

  const logout = () => {
    setAuthenticated(false);
    setPassword("");
    setOrders(normalizeWorkOrders([]));
    setNotice("");
    setTotalCm2(null);
    setCm2Error("");
    setCm2LastSync(null);
    clearDashboardSnapshot();
  };

  if (!authenticated) {
    return <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-mark"><span>SL</span></div>
        <div className="eyebrow">Studio Laser · Operações</div>
        <h1>Central de trabalhos</h1>
        <p className="auth-subtitle">Acesse os dados operacionais do Nucleus com sua conta Studio Laser.</p>
        <form onSubmit={submitLogin} className="auth-form">
          <label htmlFor="email">E-mail do Nucleus</label>
          <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@studiolaser.com.br" autoComplete="username" disabled={loginLoading} />
          <label htmlFor="password">Senha</label>
          <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Digite sua senha" autoComplete="current-password" disabled={loginLoading} />
          {loginError && <p className="form-error">{loginError}</p>}
          <button className="primary-button auth-button" type="submit" disabled={loginLoading}>{loginLoading ? "Entrando e carregando todas as páginas..." : "Entrar e carregar dados"}<span>{loginLoading ? "↻" : "→"}</span></button>
        </form>
        <p className="security-note"><span className="lock-dot">●</span> As credenciais ficam somente na memória desta sessão.</p>
      </section>
      <aside className="auth-aside"><div className="aside-grid" /><p className="aside-kicker">PAINEL OPERACIONAL</p><h2>Produção,<br />sem ruído.</h2><p>Ordens, etapas e volume produtivo em uma única visão.</p><div className="aside-footer"><span className="status-pulse" /> Sincronização sob demanda</div></aside>
    </main>;
  }

  const activeCount = orders.filter((order) => !order.isClosed).length;
  const closedCount = orders.filter((order) => order.isClosed).length;
  const waitingCount = orders.filter((order) => order.status.toLowerCase().includes("aguardando")).length;

  return <main className="app-shell" aria-busy={refreshing}>
    <div className="app-interface" inert={refreshing ? true : undefined} aria-hidden={refreshing || undefined}>
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-mark small"><span>SL</span></div><div><strong>Studio Laser</strong><small>Operações</small></div></div>
      <nav className="main-nav" aria-label="Navegação principal"><button className="nav-item active" type="button"><span>▦</span> Visão geral</button><a href="/relatorios" className="nav-item"><span>◫</span> Relatórios</a></nav>
      <div className="sidebar-bottom"><div className="connection"><span className="status-pulse" /><div><strong>Nucleus conectado</strong><small>{orders.length} trabalhos carregados</small></div></div><button className="user-row" onClick={logout}><span className="avatar">{email.slice(0, 1).toUpperCase()}</span><span><strong>{email.split("@")[0]}</strong><small>Sair da conta</small></span><span className="more">•••</span></button></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Visão geral</strong></div><div className="topbar-actions"><a href="/relatorios" className="topbar-report-button">Gerar relatório</a><span className="last-sync">Última atualização <strong>{lastSync ? formatTime(lastSync) : "—"}</strong></span><div className="top-avatar">{email.slice(0, 1).toUpperCase()}</div></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">STUDIO LASER / NUCLEUS</div><h1>Visão operacional</h1><p>{dateFrom.split("-").reverse().join("/")} — {dateTo.split("-").reverse().join("/")} · {email.split("@")[0]}</p></div><button className={`refresh-button ${refreshing ? "is-refreshing" : ""}`} onClick={openRefreshModal} disabled={refreshing}><span>↻</span>{refreshing ? "Sincronizando..." : "Atualizar dados"}</button></div>
        {notice && <div className={`notice ${noticeError ? "error" : ""}`}><span>{noticeError ? "!" : "✓"}</span>{notice}</div>}
        <div className="stats-grid">
          <article className="stat-card"><div className="stat-label">Total em andamento <span className="stat-icon blue">↗</span></div><strong>{activeCount}</strong><small>Trabalhos ativos no período</small></article>
          <article className="stat-card"><div className="stat-label">Encerrados <span className="stat-icon green">✓</span></div><strong>{closedCount}</strong><small>Separados automaticamente</small></article>
          <article className="stat-card"><div className="stat-label">Aguardando <span className="stat-icon amber">◷</span></div><strong>{waitingCount}</strong><small>Aguardando próxima etapa</small></article>
          <article className="stat-card"><div className="stat-label">Total carregado <span className="stat-icon gray">⟳</span></div><strong>{orders.length}</strong><small><b className="positive">● Conectado</b> ao Nucleus</small></article>
          <article className="stat-card production-card">
            <div className="stat-label">Total m² do usuário <button className={`card-refresh ${cm2Loading ? "is-refreshing" : ""}`} type="button" onClick={() => void refreshProductionStats()} disabled={cm2Loading} aria-label="Atualizar total em metros quadrados" title="Atualizar total em metros quadrados"><span>↻</span></button></div>
            <strong className="cm2-value">{cm2Loading && totalCm2 === null ? "—" : totalCm2 === null ? "—" : formatSquareMeters(totalCm2)}{totalCm2 !== null && <em> m²</em>}</strong>
            <small className={cm2Error ? "metric-error" : ""}>{cm2Error ? cm2Error : cm2LastSync ? `Atualizado às ${formatTime(cm2LastSync)}` : totalCm2 !== null ? "Valor salvo · entre novamente para atualizar" : password ? "Carregando produção..." : "Entre novamente para carregar o total"}</small>
          </article>
        </div>
        <section className="orders-section">
          <div className="section-heading"><div><h2>Ordens de serviço</h2><p>Dados sincronizados do Nucleus.</p></div></div>
          <div className="tabs" role="tablist"><button className={tab === "active" ? "selected" : ""} onClick={() => setTab("active")} role="tab" aria-selected={tab === "active"}>Em andamento <span>{activeCount}</span></button><button className={tab === "closed" ? "selected" : ""} onClick={() => setTab("closed")} role="tab" aria-selected={tab === "closed"}>Encerrados <span>{closedCount}</span></button></div>
          <div className="filters"><div className="search-wrap"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por cliente, nome ou número..." aria-label="Buscar ordens" /></div><select value={client} onChange={(event) => setClient(event.target.value)} aria-label="Filtrar cliente"><option>Todos os clientes</option>{clients.map((item) => <option key={item}>{item}</option>)}</select><select value={technology} onChange={(event) => setTechnology(event.target.value)} aria-label="Filtrar tecnologia"><option>Todas as tecnologias</option>{technologies.map((item) => <option key={item}>{item}</option>)}</select><select value={type} onChange={(event) => setType(event.target.value)} aria-label="Filtrar tipo"><option>Todos os tipos</option>{types.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="table-wrap"><table><thead><tr><th><button className="table-sort-button" onClick={() => toggleSort("id")}>Ordem <span>{sortIndicator("id")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("client")}>Cliente / nome <span>{sortIndicator("client")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("work")}>Trabalho <span>{sortIndicator("work")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("technology")}>Tecnologia <span>{sortIndicator("technology")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("type")}>Tipo <span>{sortIndicator("type")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("createdAt")}>Criado em <span>{sortIndicator("createdAt")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("status")}>Status <span>{sortIndicator("status")}</span></button></th><th aria-label="Ações" /></tr></thead><tbody>{visibleOrders.map((order) => <tr key={`${order.id}-${order.work}`}><td><strong className="order-id">#{order.id}</strong><small>v{order.version} · pedido {order.order}</small></td><td><strong>{order.client}</strong><span>{order.name}</span></td><td><strong>{order.work}</strong><span>Trabalho</span></td><td><strong>{order.technology}</strong><span>{order.thickness} mm</span></td><td><span className="type-pill">{order.type}</span></td><td><strong>{order.createdAt.split(" às ")[0]}</strong><span>{order.createdAt.split(" às ")[1]}</span></td><td><span className={`status-pill nucleus-status-${getNucleusStatusTone(order.status, order.isClosed)}`}><i />{order.isClosed ? "Encerrado" : order.status}</span></td><td><button className="row-more" aria-label={`Ações para ${order.id}`}>•••</button></td></tr>)}</tbody></table>{visibleOrders.length === 0 && <div className="empty-state"><strong>Nenhuma ordem encontrada</strong><span>Tente ajustar a aba ou os filtros.</span></div>}</div>
           <div className="table-footer"><span>Mostrando <strong>{visibleOrders.length}</strong> de <strong>{filteredOrders.length}</strong> ordens</span><div className="pagination" aria-label="Paginação das ordens"><button type="button" onClick={() => setCurrentPage((page) => page - 1)} disabled={currentPage === 1} aria-label="Página anterior">‹</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => <button type="button" key={page} className={page === currentPage ? "current" : ""} onClick={() => setCurrentPage(page)} aria-label={`Página ${page}`} aria-current={page === currentPage ? "page" : undefined}>{page}</button>)}<button type="button" onClick={() => setCurrentPage((page) => page + 1)} disabled={currentPage === totalPages} aria-label="Próxima página">›</button></div></div>
        </section>
      </div>
    </section>
    {refreshModalOpen && <div className="modal-backdrop"><section className="date-modal" role="dialog" aria-modal="true" aria-labelledby="refresh-modal-title"><div className="modal-header"><div><div className="eyebrow">SINCRONIZAÇÃO DO NUCLEUS</div><h2 id="refresh-modal-title">Atualizar dados</h2></div><button className="modal-close" onClick={() => setRefreshModalOpen(false)} aria-label="Fechar">×</button></div><p>Selecione o período e, opcionalmente, um cliente para limitar a extração.</p><div className="modal-date-grid"><label>Data inicial<input type="date" value={draftDateFrom} onChange={(event) => { setDraftDateFrom(event.target.value); setDateError(""); }} /></label><span>até</span><label>Data final<input type="date" value={draftDateTo} onChange={(event) => { setDraftDateTo(event.target.value); setDateError(""); }} /></label></div><label className="modal-client-field">Cliente<select value={draftClientId} onChange={(event) => setDraftClientId(event.target.value)}><option value="">Todos os clientes</option>{clientOptions.map((clientOption) => <option key={clientOption.id} value={clientOption.id}>{clientOption.label}</option>)}</select></label>{dateError && <p className="form-error modal-error">{dateError}</p>}<div className="modal-actions"><button className="secondary-button" onClick={() => setRefreshModalOpen(false)}>Cancelar</button><button className="primary-button" onClick={confirmRefresh}>Atualizar e extrair</button></div></section></div>}
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
