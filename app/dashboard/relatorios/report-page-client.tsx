"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { loadDashboardSnapshot, type DashboardSnapshot } from "../../../lib/dashboard/storage";
import type { WorkOrder } from "../../../lib/nucleus/normalize";

const formatDate = (value: string) => value.split("-").reverse().join("/");

type ReportStatusFilter = "all" | "active" | "closed";

export default function ReportPageClient() {
  const initialSnapshot = useMemo(() => loadDashboardSnapshot(), []);
  const [snapshot] = useState<DashboardSnapshot | null>(initialSnapshot);
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>("all");
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("Todos os tipos");
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const clients = useMemo(() => Array.from(new Set(snapshot?.orders.map((order) => order.client) ?? [])).sort(), [snapshot]);
  const workTypes = useMemo(() => Array.from(new Set(snapshot?.orders.map((order) => order.type) ?? [])).sort(), [snapshot]);

  const filteredOrders = useMemo(() => {
    if (!snapshot) {
      return [] as WorkOrder[];
    }

    return snapshot.orders.filter((order) => {
      const matchesStatus = statusFilter === "all"
        ? true
        : statusFilter === "active"
          ? !order.isClosed
          : order.isClosed;
      const matchesClient = selectedClients.length === 0 || selectedClients.includes(order.client);
      const matchesType = typeFilter === "Todos os tipos" || order.type === typeFilter;

      return matchesStatus && matchesClient && matchesType;
    });
  }, [selectedClients, snapshot, statusFilter, typeFilter]);

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

  const activeCount = filteredOrders.filter((order) => !order.isClosed).length;
  const closedCount = filteredOrders.filter((order) => order.isClosed).length;

  const handleGeneratePdf = async () => {
    if (!snapshot) {
      return;
    }

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
        doc.text(`Período da importação: ${formatDate(snapshot.dateFrom)} — ${formatDate(snapshot.dateTo)}`, margin + 18, 72);
        doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, pageWidth - margin - 160, 72);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(103, 200, 173);
        doc.text(`Filtrado por ${statusFilter === "all" ? "todos os status" : statusFilter === "active" ? "trabalhos em andamento" : "trabalhos encerrados"} · ${clientLabel} · ${typeFilter}`, margin + 18, 86);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(173, 186, 194);
        doc.text(`Ordens incluídas: ${filteredOrders.length}`, pageWidth - margin - 140, 86);

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("Cliente", margin + 18, yStart + 16);
        doc.text("Trabalho", margin + 160, yStart + 16);
        doc.text("Tipo", margin + 360, yStart + 16);
        doc.text("Tecnologia", margin + 460, yStart + 16);
        doc.text("Criado em", margin + 585, yStart + 16);
        doc.text("Status", pageWidth - margin - 86, yStart + 16);
      };

      const columns = [
        { key: "id", width: 46, align: "left" as const },
        { key: "client", width: 132, align: "left" as const },
        { key: "work", width: 176, align: "left" as const },
        { key: "type", width: 88, align: "left" as const },
        { key: "technology", width: 92, align: "left" as const },
        { key: "createdAt", width: 94, align: "left" as const },
        { key: "status", width: 82, align: "left" as const },
      ];

      const drawTableRow = (row: WorkOrder, index: number, y: number) => {
        const rowColor = index % 2 === 0 ? [17, 24, 31] : [12, 18, 24];
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
          row.type,
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
        doc.text("Ajuste as opções de cliente, tipo ou status para gerar um novo relatório.", margin + 18, y + 52);
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
      setStatusMessage(error instanceof Error ? error.message : "Não foi possível gerar o PDF.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="app-shell">
      <div className="app-interface">
        <aside className="sidebar">
          <div className="sidebar-brand"><div className="brand-mark small"><span>SL</span></div><div><strong>Studio Laser</strong><small>Operações</small></div></div>
          <nav className="main-nav" aria-label="Navegação principal"><Link href="/" className="nav-item"><span>▦</span> Visão geral</Link><Link href="/dashboard/relatorios" className="nav-item active"><span>◫</span> Relatórios</Link></nav>
          <div className="sidebar-bottom"><div className="connection"><span className="status-pulse" /><div><strong>Nucleus conectado</strong><small>{snapshot?.orders.length ?? 0} trabalhos carregados</small></div></div><div className="user-row"><span className="avatar">{snapshot?.email.slice(0, 1).toUpperCase() || "S"}</span><span><strong>{snapshot?.email.split("@")[0] || "Studio Laser"}</strong><small>Área de relatórios</small></span></div></div>
        </aside>
        <section className="workspace">
          <header className="topbar"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Relatórios</strong></div><div className="topbar-actions"><Link href="/" className="topbar-report-button">Visão geral</Link><span className="last-sync">Última atualização <strong>{snapshot?.lastSync ? new Date(snapshot.lastSync).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</strong></span><div className="top-avatar">{snapshot?.email.slice(0, 1).toUpperCase() || "S"}</div></div></header>
          <div className="content">
            <div className="page-heading"><div><div className="eyebrow">STUDIO LASER / RELATÓRIOS</div><h1>Relatório executivo</h1><p>Selecione os dados que deseja exportar em PDF.</p></div><Link href="/" className="refresh-button">← Voltar para a visão geral</Link></div>
            <div className="report-toolbar">
              <div className="report-filter-card">
                <h2>Filtros do relatório</h2>
                <p>Escolha um ou mais clientes para gerar um relatório segmentado.</p>
                <div className="report-filter-grid">
                <label>
                  <span>Status</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReportStatusFilter)}>
                    <option value="all">Todos os trabalhos</option>
                    <option value="active">Em andamento</option>
                    <option value="closed">Encerrados</option>
                  </select>
                </label>
                <div className="client-selector"><span>Clientes</span><div className="client-options"><label className="client-option"><input type="checkbox" checked={selectedClients.length === 0} onChange={() => setSelectedClients([])} /> Todos os clientes</label>{clients.map((client) => <label className="client-option" key={client}><input type="checkbox" checked={selectedClients.includes(client)} onChange={() => toggleClient(client)} /> {client}</label>)}</div><small className="client-selection-label">{clientLabel}</small></div>
                <label>
                  <span>Tipo de trabalho</span>
                  <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                    <option value="Todos os tipos">Todos os tipos</option>
                    {workTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="report-actions">
                <button className="primary-button" type="button" onClick={handleGeneratePdf} disabled={isGenerating}>
                  {isGenerating ? "Gerando PDF..." : "Gerar PDF em paisagem"}
                </button>
                <button className="secondary-button" type="button" onClick={() => {
                  setStatusFilter("all");
                  setSelectedClients([]);
                  setTypeFilter("Todos os tipos");
                }}>
                  Limpar filtros
                </button>
              </div>
            </div>
            <div className="report-summary-card">
              <h2>Resumo</h2>
              {!snapshot ? (
                <p className="report-note">Nenhum dado de importação encontrado. Volte à visão geral e sincronize os trabalhos primeiro.</p>
              ) : (
                <>
                  <div className="report-summary-grid">
                    <div className="report-summary-item">
                      <strong>{filteredOrders.length}</strong>
                      <span>Ordens no relatório</span>
                    </div>
                    <div className="report-summary-item">
                      <strong>{activeCount}</strong>
                      <span>Em andamento</span>
                    </div>
                    <div className="report-summary-item">
                      <strong>{closedCount}</strong>
                      <span>Encerrados</span>
                    </div>
                    <div className="report-summary-item">
                      <strong>{snapshot.orders.length}</strong>
                      <span>Origem da importação</span>
                    </div>
                  </div>
                  <div className="report-meta">
                <div className="report-meta-item">
                  <strong>Período</strong>
                  <span>{snapshot ? `${formatDate(snapshot.dateFrom)} — ${formatDate(snapshot.dateTo)}` : "—"}</span>
                </div>
                <div className="report-meta-item">
                  <strong>Última sincronização</strong>
                  <span>{snapshot?.lastSync ? new Date(snapshot.lastSync).toLocaleString("pt-BR") : "—"}</span>
                </div>
              </div>
                  {statusMessage ? <p className="report-note">{statusMessage}</p> : null}
                </>
              )}
            </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
