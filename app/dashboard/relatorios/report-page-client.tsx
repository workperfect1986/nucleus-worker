"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { loadDashboardSnapshot, type DashboardSnapshot } from "../../../lib/dashboard/storage";
import type { WorkOrder } from "../../../lib/nucleus/normalize";

const formatDate = (value: string) => value.split("-").reverse().join("/");

export default function ReportPageClient() {
  const initialSnapshot = loadDashboardSnapshot();
  const [snapshot] = useState<DashboardSnapshot | null>(initialSnapshot);
  const [selectedClients, setSelectedClients] = useState<string[]>(() => {
    if (!initialSnapshot) {
      return [];
    }

    return Array.from(new Set(initialSnapshot.orders.map((order) => order.client))).sort();
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const clients = useMemo(() => Array.from(new Set(snapshot?.orders.map((order) => order.client) ?? [])).sort(), [snapshot]);

  const visibleOrders = useMemo(() => {
    if (!snapshot) {
      return [] as WorkOrder[];
    }

    if (selectedClients.length === 0) {
      return snapshot.orders;
    }

    return snapshot.orders.filter((order) => selectedClients.includes(order.client));
  }, [selectedClients, snapshot]);

  const handleGeneratePdf = async () => {
    if (!snapshot) {
      return;
    }

    setIsGenerating(true);
    setStatusMessage("");

    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      let cursorY = 60;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text("Studio Laser · Relatório de produção", margin, cursorY);
      cursorY += 28;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text(`Período da importação: ${formatDate(snapshot.dateFrom)} — ${formatDate(snapshot.dateTo)}`, margin, cursorY);
      cursorY += 16;
      doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, margin, cursorY);
      cursorY += 16;
      doc.text(`Clientes selecionados: ${selectedClients.length > 0 ? selectedClients.join(", ") : "Todos os clientes"}`, margin, cursorY);
      cursorY += 24;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`Ordens incluídas (${visibleOrders.length})`, margin, cursorY);
      cursorY += 16;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);

      if (visibleOrders.length === 0) {
        doc.text("Nenhuma ordem encontrada para os filtros selecionados.", margin, cursorY);
      } else {
        visibleOrders.forEach((order, index) => {
          if (cursorY > pageHeight - 120) {
            doc.addPage();
            cursorY = 60;
          }

          const heading = `${index + 1}. #${order.id} · ${order.client} · ${order.work}`;
          const headingLines = doc.splitTextToSize(heading, pageWidth - margin * 2);
          headingLines.forEach((line: string) => {
            doc.text(line, margin, cursorY);
            cursorY += 12;
          });

          const details = `${order.createdAt} | ${order.technology} | ${order.type} | ${order.status}`;
          const detailLines = doc.splitTextToSize(details, pageWidth - margin * 2);
          detailLines.forEach((line: string) => {
            doc.text(line, margin + 12, cursorY);
            cursorY += 10;
          });

          cursorY += 8;
        });
      }

      const fileName = `relatorio-studio-laser-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fileName);
      setStatusMessage(`PDF gerado com ${visibleOrders.length} ordem(s) para ${selectedClients.length > 0 ? selectedClients.length : "todos"} cliente(s).`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Não foi possível gerar o PDF.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="report-shell">
      <div className="report-content">
        <div className="report-card">
          <div className="report-card-header">
            <div className="eyebrow">STUDIO LASER / RELATÓRIOS</div>
            <h1>Gerador de relatório em PDF</h1>
            <p>Selecione os clientes para gerar um PDF com as ordens importadas na data atual do dashboard.</p>
          </div>
          <div className="report-grid">
            <section className="report-panel">
              <h2>Clientes</h2>
              <p>Os clientes selecionados serão incluídos no PDF. Se nenhum for selecionado, o relatório considera todos os clientes importados.</p>
              {!snapshot ? (
                <div className="report-empty">Nenhum dado de importação encontrado. Volte à visão geral do dashboard e sincronize os trabalhos primeiro.</div>
              ) : (
                <>
                  <select
                    className="report-select"
                    multiple
                    value={selectedClients}
                    onChange={(event) => {
                      const nextValues = Array.from(event.target.selectedOptions, (option) => option.value);
                      setSelectedClients(nextValues);
                    }}
                  >
                    {clients.map((client) => (
                      <option key={client} value={client}>
                        {client}
                      </option>
                    ))}
                  </select>
                  <div className="report-actions">
                    <button className="primary-button" type="button" onClick={handleGeneratePdf} disabled={isGenerating}>
                      {isGenerating ? "Gerando PDF..." : "Gerar PDF"}
                    </button>
                    <button className="secondary-button" type="button" onClick={() => setSelectedClients(clients)}>
                      Selecionar todos
                    </button>
                  </div>
                  <p className="report-note">O período do relatório usa sempre a mesma data da importação atual do dashboard, sem possibilidade de alteração aqui.</p>
                </>
              )}
            </section>
            <section className="report-panel">
              <h2>Resumo da importação</h2>
              <p>Abaixo você acompanha a origem do relatório e o volume de ordens que será exportado.</p>
              <div className="report-meta">
                <div className="report-meta-item">
                  <strong>Período</strong>
                  <span>{snapshot ? `${formatDate(snapshot.dateFrom)} — ${formatDate(snapshot.dateTo)}` : "—"}</span>
                </div>
                <div className="report-meta-item">
                  <strong>Ordens disponíveis</strong>
                  <span>{snapshot ? snapshot.orders.length : 0}</span>
                </div>
                <div className="report-meta-item">
                  <strong>Ordens no PDF</strong>
                  <span>{visibleOrders.length}</span>
                </div>
                <div className="report-meta-item">
                  <strong>Última sincronização</strong>
                  <span>{snapshot?.lastSync ? new Date(snapshot.lastSync).toLocaleString("pt-BR") : "—"}</span>
                </div>
              </div>
              {statusMessage ? <p className="report-note">{statusMessage}</p> : null}
              <div className="report-actions">
                <Link href="/" className="report-link">
                  ← Voltar para a visão geral
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
