"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { jsPDF } from "jspdf";
import { clearDashboardSnapshot, loadDashboardSnapshot, subscribeDashboardSnapshot, type DashboardSnapshot } from "../../lib/dashboard/storage";
import type { WorkOrder } from "../../lib/nucleus/normalize";
import { getNucleusStatusTone } from "../../lib/nucleus/status";

const formatDate = (value: string) => value.split("-").reverse().join("/");
const PAGE_SIZE = 25;
const SESSION_KEY = "studio-laser-dashboard-session";

type ReportStatusFilter = "all" | "active" | "closed";
type ReportSortKey = "id" | "client" | "work" | "technology" | "createdAt" | "status";
type SortDirection = "asc" | "desc";

const getReportSortValue = (order: WorkOrder, key: ReportSortKey) => {
  if (key === "id") return Number(order.id);
  if (key === "createdAt") return order.createdAt.split(" às ")[0].split("/").reverse().join("-");
  if (key === "status") return order.isClosed ? "Encerrado" : order.status;
  return order[key];
};

export default function ReportPageClient() {
  const snapshot = useSyncExternalStore(subscribeDashboardSnapshot, loadDashboardSnapshot, () => null) as DashboardSnapshot | null;
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>("active");
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [sortKey, setSortKey] = useState<ReportSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pagination, setPagination] = useState({ key: "", page: 1 });

  const snapshotOrdersInPeriod = useMemo(() => snapshot?.orders.filter((order) => {
    const orderDate = order.createdAt.split(" às ")[0].split("/").reverse().join("-");
    return (!snapshot.dateFrom || orderDate >= snapshot.dateFrom) && (!snapshot.dateTo || orderDate <= snapshot.dateTo);
  }) ?? [], [snapshot]);
  const clients = useMemo(() => Array.from(new Set(snapshotOrdersInPeriod.map((order) => order.client))).sort(), [snapshotOrdersInPeriod]);
  const clientFilteredOrders = useMemo(() => selectedClients.length === 0
    ? snapshotOrdersInPeriod
    : snapshotOrdersInPeriod.filter((order) => selectedClients.includes(order.client)), [selectedClients, snapshotOrdersInPeriod]);

  const toggleSort = (nextKey: ReportSortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  };

  const sortIndicator = (key: ReportSortKey) => sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : "↕";
  const allFilteredOrders = useMemo(() => {
    if (!snapshot) {
      return [] as WorkOrder[];
    }

    return clientFilteredOrders.filter((order) => {
      const matchesStatus = statusFilter === "all"
        ? true
        : statusFilter === "active"
          ? !order.isClosed
          : order.isClosed;
      return matchesStatus;
    }).sort((left, right) => {
      const leftValue = getReportSortValue(left, sortKey);
      const rightValue = getReportSortValue(right, sortKey);
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), "pt-BR", { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [clientFilteredOrders, snapshot, sortDirection, sortKey, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(allFilteredOrders.length / PAGE_SIZE));
  const pageKey = `${JSON.stringify(selectedClients)}|${snapshot ? "loaded" : "empty"}|${sortDirection}|${sortKey}|${statusFilter}`;
  const currentPage = pagination.key === pageKey ? Math.min(pagination.page, totalPages) : 1;
  const setCurrentPage = (nextPage: number | ((page: number) => number)) => {
    setPagination((current) => {
      const page = current.key === pageKey ? current.page : 1;
      return { key: pageKey, page: typeof nextPage === "function" ? nextPage(page) : nextPage };
    });
  };
  const filteredOrders = allFilteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const printableOrders = useMemo(() => [...allFilteredOrders].sort((left, right) => {
    const clientComparison = left.client.localeCompare(right.client, "pt-BR", { sensitivity: "base" });
    if (clientComparison !== 0) return clientComparison;

    const nameComparison = left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" });
    if (nameComparison !== 0) return nameComparison;

    return Number(left.id) - Number(right.id);
  }), [allFilteredOrders]);

  const clientLabel = selectedClients.length === 0
    ? "Todos os clientes"
    : selectedClients.length === 1
      ? selectedClients[0]
      : `${selectedClients.length} clientes selecionados`;

  const toggleClient = (client: string) => {
    setSelectedClients((current) => current.includes(client)
      ? current.filter((item) => item !== client)
      : [...current, client]);
  };

  const activeCount = clientFilteredOrders.filter((order) => !order.isClosed).length;
  const closedCount = clientFilteredOrders.filter((order) => order.isClosed).length;
  const goToDashboard = () => window.location.assign("/");
  const goToReports = () => window.location.assign("/relatorios");
  const logout = () => {
    window.sessionStorage.removeItem(SESSION_KEY);
    clearDashboardSnapshot();
    window.location.assign("/");
  };

  const handleGeneratePdf = async () => {
    if (!snapshot) {
      return;
    }
    const reportSnapshot = snapshot;

    setIsGenerating(true);
    setStatusMessage("Abrindo a visualização de impressão...");
    window.setTimeout(() => {
      window.print();
      setIsGenerating(false);
      setStatusMessage(`Relatório pronto para salvar em PDF com ${printableOrders.length} ordem(s).`);
    }, 0);
    return;

    setIsGenerating(true);
    setStatusMessage("");

    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 36;
      const innerWidth = pageWidth - margin * 2;
      const contentTop = 132;
      const headerHeight = 86;
      const tableHeaderHeight = 22;
      const rowHeight = 20;

      const addHeader = (yStart: number) => {
        doc.setFillColor(14, 20, 25);
        doc.roundedRect(margin, 28, innerWidth, headerHeight, 8, 8, "F");

        doc.setDrawColor(69, 91, 105);
        doc.setLineWidth(0.5);
        doc.line(margin, 56, pageWidth - margin, 56);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(240, 246, 247);
        doc.text("Studio Laser · Relatório de produção", margin + 18, 54);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(178, 191, 199);
        doc.text(`Período da importação: ${formatDate(reportSnapshot.dateFrom)} — ${formatDate(reportSnapshot.dateTo)}`, margin + 18, 72);
        doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, pageWidth - margin - 160, 72);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(103, 200, 173);
        doc.text(`Filtrado por ${statusFilter === "all" ? "todos os status" : statusFilter === "active" ? "trabalhos em andamento" : "trabalhos encerrados"} · ${clientLabel}`, margin + 18, 86);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(173, 186, 194);
        doc.text(`Ordens incluídas: ${filteredOrders.length}`, pageWidth - margin - 140, 86);

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("Cliente", margin + 18, yStart + 16);
        doc.text("Trabalho", margin + 160, yStart + 16);
        doc.text("Tecnologia", margin + 360, yStart + 16);
        doc.text("Criado em", margin + 585, yStart + 16);
        doc.text("Status", pageWidth - margin - 86, yStart + 16);
      };

      const columns = [
        { key: "id", width: 46, align: "left" as const },
        { key: "client", width: 132, align: "left" as const },
        { key: "work", width: 176, align: "left" as const },
        { key: "technology", width: 92, align: "left" as const },
        { key: "createdAt", width: 94, align: "left" as const },
        { key: "status", width: 82, align: "left" as const },
      ];

      const drawTableRow = (row: WorkOrder, index: number, y: number) => {
        const rowColor: [number, number, number] = index % 2 === 0 ? [17, 24, 31] : [12, 18, 24];
        doc.setFillColor(...rowColor);
        doc.roundedRect(margin, y, innerWidth, rowHeight, 4, 4, "F");

        const xPositions = [margin + 12];
        columns.slice(0, -1).forEach((_, columnIndex) => {
          const previousWidth = columns[columnIndex].width;
          xPositions.push(xPositions[xPositions.length - 1] + previousWidth + 8);
        });

        const textX = margin + 12;
        const values = [
          `#${row.id}`,
          row.client,
          row.work,
          row.technology,
          row.createdAt.split(" às ")[0],
          row.isClosed ? "Encerrado" : row.status,
        ];

        values.forEach((value, columnIndex) => {
          const column = columns[columnIndex];
          const width = column.width;
          const x = xPositions[columnIndex];
          const lines = doc.splitTextToSize(value, width - 10);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          doc.setTextColor(226, 233, 237);
          const textY = y + rowHeight / 2 + 2;
          doc.text(lines[0] ?? "", x, textY);
        });

        doc.setTextColor(103, 200, 173);
        doc.setFont("helvetica", "bold");
        doc.text(`#${row.id}`, textX, y + rowHeight / 2 + 2);
      };

      let y = contentTop;

      const startNewPage = () => {
        doc.addPage();
        y = contentTop;
        addHeader(contentTop - 14);
      };

      addHeader(contentTop - 14);
      y += tableHeaderHeight + 8;

      if (filteredOrders.length === 0) {
        doc.setFillColor(18, 25, 33);
        doc.roundedRect(margin, y, innerWidth, 70, 8, 8, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(240, 246, 247);
        doc.text("Nenhuma ordem encontrada para os filtros selecionados.", margin + 18, y + 30);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(175, 187, 195);
        doc.text("Ajuste as opções de cliente ou status para gerar um novo relatório.", margin + 18, y + 52);
      } else {
        filteredOrders.forEach((order, index) => {
          if (y + rowHeight > pageHeight - 40) {
            startNewPage();
          }
          drawTableRow(order, index, y);
          y += rowHeight + 4;
        });
      }

      const fileName = `relatorio-studio-laser-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fileName);
      setStatusMessage(`PDF gerado com ${filteredOrders.length} ordem(s) usando os filtros selecionados.`);
    } catch (error) {
      const errorRecord = error as { message?: unknown };
      const message: string = typeof errorRecord.message === "string"
        ? String(errorRecord.message)
        : "Não foi possível gerar o PDF.";
      setStatusMessage(message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
    <main className="app-shell">
      <div className="app-interface">
        <header className="site-header">
          <button className="header-brand" type="button" onClick={goToDashboard} aria-label="Studio Laser — Visão geral"><div className="brand-mark small"><span>SL</span></div><div><strong>Studio Laser</strong><small>Operações</small></div></button>
          <nav className="header-nav" aria-label="Navegação principal"><button className="header-nav-item" type="button" onClick={goToDashboard}><span>◆</span> Visão geral</button><button type="button" onClick={goToReports} className="header-nav-item active" aria-current="page"><span>◇</span> Relatórios</button></nav>
          <div className="header-meta"><div className="header-connection"><span className="status-pulse" /><div><strong>Dados carregados</strong><small>{snapshotOrdersInPeriod.length} ordens · {snapshot?.lastSync ? new Date(snapshot.lastSync).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "aguardando"}</small></div></div><button className="header-user" type="button" onClick={logout} aria-label="Sair da conta"><span className="avatar">{snapshot?.email.slice(0, 1).toUpperCase() || "S"}</span><span><strong>{snapshot?.email.split("@")[0] || "Studio Laser"}</strong><small>Sair</small></span></button></div>
        </header>
        <section className="workspace">
          <div className="content">
            <div className="page-heading"><div><div className="eyebrow">STUDIO LASER / NUCLEUS</div><h1>Relatórios</h1><p>{snapshot ? `${formatDate(snapshot.dateFrom)} — ${formatDate(snapshot.dateTo)} · Selecione os dados para exportar.` : "Sincronize a dashboard para gerar um relatório."}</p></div><div className="page-actions"><button className="secondary-action" type="button" onClick={goToDashboard}><span>←</span> Visão geral</button><button className="refresh-button" type="button" onClick={handleGeneratePdf} disabled={isGenerating || !snapshot}><span>↓</span>{isGenerating ? "Gerando PDF..." : "Gerar relatório"}</button></div></div>
            <div className="stats-grid frost-stats report-stats">
              <article className="stat-card"><div className="stat-label">Ordens no relatório <span className="stat-icon blue">↗</span></div><strong>{allFilteredOrders.length}</strong><small>Após aplicar os filtros</small></article>
              <article className="stat-card"><div className="stat-label">Em andamento <span className="stat-icon blue">↗</span></div><strong>{activeCount}</strong><small>Trabalhos ativos selecionados</small></article>
              <article className="stat-card"><div className="stat-label">Encerrados <span className="stat-icon green">✓</span></div><strong>{closedCount}</strong><small>Trabalhos concluídos</small></article>
              <article className="stat-card"><div className="stat-label">Clientes <span className="stat-icon amber">◷</span></div><strong>{selectedClients.length || clients.length}</strong><small>{clientLabel}</small></article>
            </div>
            <section className="orders-section">
              <div className="section-heading"><div><h2>Ordens do relatório</h2><p>Dados sincronizados do Nucleus.</p></div><div className="report-actions"><button className="secondary-button" type="button" onClick={() => { setStatusFilter("all"); setSelectedClients([]); }}>Limpar filtros</button></div></div>
              <div className="tabs" role="tablist"><button className={statusFilter === "all" ? "selected" : ""} onClick={() => setStatusFilter("all")} role="tab" aria-selected={statusFilter === "all"}>Todos <span>{clientFilteredOrders.length}</span></button><button className={statusFilter === "active" ? "selected" : ""} onClick={() => setStatusFilter("active")} role="tab" aria-selected={statusFilter === "active"}>Em andamento <span>{activeCount}</span></button><button className={statusFilter === "closed" ? "selected" : ""} onClick={() => setStatusFilter("closed")} role="tab" aria-selected={statusFilter === "closed"}>Encerrados <span>{closedCount}</span></button></div>
               <div className="filters report-filters"><div className="client-selector"><span>Clientes</span><div className="client-options" role="group" aria-label="Filtrar clientes"><button className={`client-option ${selectedClients.length === 0 ? "selected" : ""}`} type="button" aria-pressed={selectedClients.length === 0} onClick={() => setSelectedClients([])}>Todos os clientes</button>{clients.map((client) => <button className={`client-option ${selectedClients.includes(client) ? "selected" : ""}`} type="button" aria-pressed={selectedClients.includes(client)} key={client} onClick={() => toggleClient(client)}>{client}</button>)}</div></div><button className="primary-button report-generate-button" type="button" onClick={handleGeneratePdf} disabled={isGenerating || !snapshot}>{isGenerating ? "Gerando..." : "Gerar PDF"}</button></div>
              <div className="table-wrap report-orders-table"><table><thead><tr><th><button className="table-sort-button" onClick={() => toggleSort("id")}>Ordem <span>{sortIndicator("id")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("client")}>Cliente / Nome <span>{sortIndicator("client")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("createdAt")}>Criado em <span>{sortIndicator("createdAt")}</span></button></th><th><button className="table-sort-button" onClick={() => toggleSort("status")}>Status <span>{sortIndicator("status")}</span></button></th></tr></thead><tbody>{filteredOrders.map((order, index) => <tr key={`${order.id}-${order.work}-${index}`}><td><strong className="order-id">#{order.id}</strong><small>v{order.version} · pedido {order.order}</small></td><td><strong>{order.client}</strong><span>{order.name}</span></td><td><strong>{order.createdAt.split(" às ")[0]}</strong><span>{order.createdAt.split(" às ")[1]}</span></td><td><span className={`status-pill nucleus-status-${getNucleusStatusTone(order.status, order.isClosed)}`}><i />{order.isClosed ? "Encerrado" : order.status}</span></td></tr>)}</tbody></table>{filteredOrders.length === 0 && <div className="empty-state"><strong>Nenhuma ordem encontrada</strong><span>Ajuste os filtros ou sincronize os dados na dashboard.</span></div>}</div>
              <div className="mobile-order-list report-mobile-order-list">{filteredOrders.map((order) => <article className="mobile-order-card" key={`report-mobile-${order.id}-${order.work}`}><div className="mobile-order-top"><strong className="order-id">#{order.id}</strong><span className={`status-pill nucleus-status-${getNucleusStatusTone(order.status, order.isClosed)}`}><i />{order.isClosed ? "Encerrado" : order.status}</span></div><h3>{order.client}</h3><p>{order.name}</p><dl><div><dt>Criada em</dt><dd>{order.createdAt}</dd></div></dl><small>v{order.version} · pedido {order.order}</small></article>)}{filteredOrders.length === 0 && <div className="empty-state"><strong>Nenhuma ordem encontrada</strong><span>Ajuste os filtros ou sincronize os dados na dashboard.</span></div>}</div>
               <div className="table-footer"><span>Mostrando <strong>{filteredOrders.length}</strong> de <strong>{allFilteredOrders.length}</strong> ordens</span><div className="pagination" aria-label="Paginação do relatório"><button type="button" onClick={() => setCurrentPage((page) => page - 1)} disabled={currentPage === 1} aria-label="Página anterior">‹</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => <button type="button" key={page} className={page === currentPage ? "current" : ""} onClick={() => setCurrentPage(page)} aria-label={`Página ${page}`} aria-current={page === currentPage ? "page" : undefined}>{page}</button>)}<button type="button" onClick={() => setCurrentPage((page) => page + 1)} disabled={currentPage === totalPages} aria-label="Próxima página">›</button></div>{statusMessage ? <span className="report-status-message">{statusMessage}</span> : null}</div>
            </section>
          </div>
        </section>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Navegação mobile"><Link href="/"><span>◆</span>Visão geral</Link><Link href="/relatorios" aria-current="page"><span>◇</span>Relatórios</Link><button type="button" onClick={logout}><span>●</span>Conta</button></nav>
    </main>
    <section className="print-report" aria-hidden="true">
      <header className="print-report-header">
        <div>
          <div className="print-kicker">STUDIO LASER · OPERAÇÕES</div>
          <h1>Relatório executivo</h1>
          <p>Produção consolidada do período selecionado</p>
        </div>
        <div className="print-brand-mark">SL</div>
      </header>
      <div className="print-report-meta">
        <div><span>Período</span><strong>{snapshot ? `${formatDate(snapshot.dateFrom)} — ${formatDate(snapshot.dateTo)}` : "—"}</strong></div>
        <div><span>Gerado em</span><strong>{new Date().toLocaleString("pt-BR")}</strong></div>
        <div><span>Filtros</span><strong>{clientLabel} · {statusFilter === "all" ? "Todos os status" : statusFilter === "active" ? "Em andamento" : "Encerrados"}</strong></div>
      </div>
      <div className="print-report-summary">
        <div><span>Ordens no relatório</span><strong>{printableOrders.length}</strong></div>
        <div><span>Em andamento</span><strong>{activeCount}</strong></div>
        <div><span>Encerrados</span><strong>{closedCount}</strong></div>
        <div><span>Clientes</span><strong>{selectedClients.length || clients.length}</strong></div>
      </div>
      <div className="print-report-table-wrap">
        <table>
           <thead><tr><th>Ordem</th><th>Cliente / Nome</th><th>Criado em</th><th>Status</th></tr></thead>
          <tbody>{printableOrders.map((order) => <tr key={`print-${order.id}-${order.work}`}>
            <td><strong>#{order.id}</strong><small>v{order.version} · pedido {order.order}</small></td>
            <td><strong>{order.client}</strong><small>{order.name}</small></td>
            <td><strong>{order.createdAt.split(" às ")[0]}</strong><small>{order.createdAt.split(" às ")[1]}</small></td>
            <td><span className={`print-status nucleus-status-${getNucleusStatusTone(order.status, order.isClosed)}`}>{order.isClosed ? "Encerrado" : order.status}</span></td>
          </tr>)}</tbody>
        </table>
        {printableOrders.length === 0 && <div className="print-empty-state"><strong>Nenhuma ordem encontrada</strong><span>Não há dados para os filtros selecionados.</span></div>}
      </div>
      <footer className="print-report-footer"><span>Studio Laser · Relatório de produção</span><span>Documento gerado pelo Nucleus Painel</span></footer>
    </section>
    </>
  );
}
