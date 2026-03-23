/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EventItem, PenaltyCompletion, Session, Snapshot } from '../types'
import { computeByDorsal } from './penalties'
import { computeNetTime, type ClassificationBibRow, type ClassificationSections } from './participants'
import { formatDurationSeconds } from './time'

export type PdfMeta = {
  competitionName: string
  competitionCode: string
  refereeName: string
  generatedAt: string
}

export type PdfSaveMode = 'preview' | 'download' | 'previewAndDownload'

export type PdfSaveOptions = {
  filename?: string
  mode?: PdfSaveMode
}


function sanitizeFilePart(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'sense_nom'
}

export function suggestedRefereePdfFilename(meta: PdfMeta) {
  const competitionPart = sanitizeFilePart(meta.competitionName)
  const refereePart = sanitizeFilePart(meta.refereeName)
  const codePart = sanitizeFilePart(meta.competitionCode)
  return `${competitionPart}__FaltesMN_${codePart}_${refereePart}.pdf`
}

function fmtTime(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function fmtGeneratedAt(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} (${fmtTime(iso)})`
}

function colorFill(c: 'B' | 'G' | 'V' | 'A') {
  if (c === 'G') return [255, 245, 157]
  if (c === 'V') return [255, 205, 210]
  if (c === 'A') return [220, 252, 231]
  return [255, 255, 255]
}

function eventDescription(e: EventItem) {
  if ((e.eventType || 'fault') === 'withdraw') return 'Abandó del/de la competidor/a'
  if ((e.eventType || 'fault') === 'assist' || e.color === 'A') {
    return `Auxili a dorsal ${e.assistTargetBib ?? '-'} durant ${formatDurationSeconds(e.assistDurationSeconds || 0)}`
  }
  return e.faultText
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function previewBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    // ignore popup issues
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 15000)
}

function savePdfDoc(doc: any, filename: string, options?: PdfSaveOptions) {
  const blob = doc.output('blob') as Blob
  const mode = options?.mode || 'preview'
  if (mode === 'download') {
    downloadBlob(filename, blob)
    return
  }
  if (mode === 'previewAndDownload') {
    previewBlob(blob)
    downloadBlob(filename, blob)
    return
  }
  previewBlob(blob)
}

function pageFooter(doc: any) {
  const pageSize = doc.internal.pageSize
  const pageHeight = typeof pageSize.getHeight === 'function' ? pageSize.getHeight() : pageSize.height
  doc.setFontSize(8)
  doc.text(String(doc.getCurrentPageInfo().pageNumber), pageSize.width - 12, pageHeight - 6, { align: 'right' })
}

export function exportSnapshotJson(session: Session, snapshot: Snapshot) {
  const payload = {
    exportedAt: new Date().toISOString(),
    competition: snapshot.competition,
    actor: session.actor,
    joinToken: session.joinToken,
    events: snapshot.events,
    checks: snapshot.checks,
    alertAcks: (snapshot as any).alertAcks || {},
    penaltyCompletions: snapshot.penaltyCompletions,
    status: snapshot.status,
    actors: snapshot.actors,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  downloadBlob(`FaltesMN_${snapshot.competition.code}_${session.actor.role}_${session.actor.name.replace(/\s+/g, '_')}.json`, blob)
}

export async function exportPdfPerReferee(meta: PdfMeta, events: EventItem[], options?: PdfSaveOptions) {
  const mod = await import('jspdf')
  const { jsPDF } = mod as any
  await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })

  doc.setFontSize(14)
  doc.text(`FaltesMN - Registre d'àrbitre`, 14, 14)
  doc.setFontSize(11)
  doc.text(`Competició: ${meta.competitionName} (${meta.competitionCode})`, 14, 22)
  doc.text(`Àrbitre: ${meta.refereeName}`, 14, 28)
  doc.text(`Generat: ${fmtGeneratedAt(meta.generatedAt)}`, 14, 34)

  const sorted = events.slice().sort((a, b) => (a.capturedAt + a.id).localeCompare(b.capturedAt + b.id))
  const body = sorted.map((e) => [fmtTime(e.capturedAt), String(e.bib), e.faultCode, eventDescription(e)])

  ;(doc as any).autoTable({
    startY: 40,
    head: [['Hora (captura)', 'Dorsal', 'Codi', 'Fet']],
    body,
    styles: { fontSize: 9, cellPadding: 2 },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 2) {
        const ev = sorted[data.row.index]
        data.cell.styles.fillColor = colorFill(ev.color)
      }
    },
    didDrawPage: () => pageFooter(doc)
  })

  savePdfDoc(doc, options?.filename || suggestedRefereePdfFilename(meta), options)
}

export async function exportPdfAllReferees(meta: PdfMeta, events: EventItem[], options?: PdfSaveOptions) {
  const mod = await import('jspdf')
  const { jsPDF } = mod as any
  await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  doc.setFontSize(14)
  doc.text(`FaltesMN - Registre per àrbitres`, 14, 14)
  doc.setFontSize(11)
  doc.text(`Competició: ${meta.competitionName} (${meta.competitionCode})`, 14, 22)
  doc.text(`Generat: ${fmtGeneratedAt(meta.generatedAt)}`, 14, 28)

  const byRef = new Map<string, EventItem[]>()
  for (const ev of events) {
    const key = ev.actorName || 'Àrbitre'
    const arr = byRef.get(key) || []
    arr.push(ev)
    byRef.set(key, arr)
  }
  const names = Array.from(byRef.keys()).sort((a, b) => a.localeCompare(b))
  let y = 36

  for (const name of names) {
    const list = (byRef.get(name) || []).slice().sort((a, b) => (a.capturedAt + a.id).localeCompare(b.capturedAt + b.id))
    if (y > 250) {
      doc.addPage()
      y = 18
    }
    doc.setFillColor(17, 24, 39)
    doc.rect(14, y, 182, 8, 'F')
    doc.setTextColor(255, 255, 255)
    doc.text(name, 16, y + 5.5)
    doc.setTextColor(0, 0, 0)
    ;(doc as any).autoTable({
      startY: y + 10,
      head: [['Hora', 'Dorsal', 'Codi', 'Fet']],
      body: list.map((e) => [fmtTime(e.capturedAt), String(e.bib), e.faultCode, eventDescription(e)]),
      styles: { fontSize: 8.7, cellPadding: 1.8 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 2) {
          const ev = list[data.row.index]
          data.cell.styles.fillColor = colorFill(ev.color)
        }
      },
      didDrawPage: () => pageFooter(doc)
    })
    y = (doc as any).lastAutoTable.finalY + 6
  }

  savePdfDoc(doc, `FaltesMN_${meta.competitionCode}_ARBITRES.pdf`, options)
}

export async function exportPdfGlobal(meta: PdfMeta, events: EventItem[], getChecked: (id: string) => boolean, options?: PdfSaveOptions) {
  const mod = await import('jspdf')
  const { jsPDF } = mod as any
  await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })

  doc.setFontSize(14)
  doc.text(`FaltesMN - Registre global (Taula)`, 14, 14)
  doc.setFontSize(11)
  doc.text(`Competició: ${meta.competitionName} (${meta.competitionCode})`, 14, 22)
  doc.text(`Generat: ${fmtGeneratedAt(meta.generatedAt)}`, 14, 28)

  const sorted = events.slice().sort((a, b) => (a.capturedAt + a.id).localeCompare(b.capturedAt + b.id))
  const body = sorted.map((e) => [getChecked(e.id) ? 'X' : '', fmtTime(e.capturedAt), e.actorName, String(e.bib), e.faultCode, eventDescription(e)])

  ;(doc as any).autoTable({
    startY: 34,
    head: [['Control', 'Hora (captura)', 'Àrbitre', 'Dorsal', 'Codi', 'Fet']],
    body,
    styles: { fontSize: 8.8, cellPadding: 2.1, valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 24 },
      2: { cellWidth: 34 },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 0 && data.cell.text?.[0] === 'X') {
        data.cell.styles.textColor = [185, 28, 28]
        data.cell.styles.fontSize = 12
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.section === 'body' && data.column.index === 4) {
        const ev = sorted[data.row.index]
        data.cell.styles.fillColor = colorFill(ev.color)
      }
    },
    didDrawPage: () => pageFooter(doc)
  })

  savePdfDoc(doc, `FaltesMN_${meta.competitionCode}_GLOBAL.pdf`, options)
}

export async function exportPdfByDorsal(meta: PdfMeta, events: EventItem[], completions: Record<string, PenaltyCompletion>, options?: PdfSaveOptions) {
  const mod = await import('jspdf')
  const { jsPDF } = mod as any
  await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })

  doc.setFontSize(14)
  doc.text(`FaltesMN - Registre per dorsals`, 14, 14)
  doc.setFontSize(11)
  doc.text(`Competició: ${meta.competitionName} (${meta.competitionCode})`, 14, 22)
  doc.text(`Generat: ${fmtGeneratedAt(meta.generatedAt)}`, 14, 28)

  const summaries = computeByDorsal(events, completions)
  const bibs = Array.from(summaries.keys()).sort((a, b) => a - b)
  let y = 36

  for (const bib of bibs) {
    const s = summaries.get(bib)!
    const list = events.filter((e) => e.bib === bib).slice().sort((a, b) => (a.capturedAt + a.id).localeCompare(b.capturedAt + b.id))

    if (y > 250) {
      doc.addPage()
      y = 18
    }

    doc.setFillColor(17, 24, 39)
    doc.rect(14, y, 182, 8, 'F')
    doc.setTextColor(255, 255, 255)
    doc.text(`DORSAL ${bib}`, 16, y + 5.5)
    doc.setTextColor(0, 0, 0)
    y += 12

    const summaryBits = []
    if (s.dsq) summaryBits.push('VERMELLA / desqualificat')
    else if (s.withdrawn) summaryBits.push('RETIRAT')
    else {
      if (s.yellowCount > 0) summaryBits.push(`Grogues: ${s.yellowCount}`)
      if (s.whiteRemainder > 0) summaryBits.push(`Blanques: ${s.whiteRemainder}`)
      if (s.penaltyTotalMinutes > 0) summaryBits.push(`Penalització total: ${s.penaltyTotalMinutes} min`)
    }
    if (s.greenAssistCount > 0) summaryBits.push(`Verdes: ${s.greenAssistCount} (-${formatDurationSeconds(s.greenAssistSeconds)})`)
    if (!summaryBits.length) summaryBits.push('Sense resum especial')

    doc.setFontSize(10)
    doc.text(summaryBits.join(' · '), 14, y)
    y += 4
    if (s.dsqReason) {
      doc.text(`Motiu: ${s.dsqReason}`, 14, y + 4)
      y += 6
    }

    ;(doc as any).autoTable({
      startY: y + 2,
      head: [['Hora', 'Àrbitre', 'Codi', 'Fet']],
      body: list.map((e) => [fmtTime(e.capturedAt), e.actorName, e.faultCode, eventDescription(e)]),
      styles: { fontSize: 8.5, cellPadding: 1.8 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 2) {
          const ev = list[data.row.index]
          data.cell.styles.fillColor = colorFill(ev.color)
        }
      },
      didDrawPage: () => pageFooter(doc)
    })

    y = (doc as any).lastAutoTable.finalY + 4

    if (s.penalties.length) {
      ;(doc as any).autoTable({
        startY: y,
        head: [['Penalització', 'Origina', 'Hora', 'Complerta']],
        body: s.penalties.map((p) => [`+${p.minutes} min`, p.triggeredBy, fmtTime(p.capturedAt), p.completed ? 'Sí' : 'No']),
        styles: { fontSize: 8.5, cellPadding: 1.8 },
        headStyles: { fillColor: [250, 204, 21], textColor: [17, 24, 39] },
        didDrawPage: () => pageFooter(doc)
      })
      y = (doc as any).lastAutoTable.finalY + 6
    }

    if (s.assists.length) {
      ;(doc as any).autoTable({
        startY: y,
        head: [['Targeta verda', 'Dorsal auxiliat', 'Temps a descomptar', 'Hora']],
        body: s.assists.map((a) => ['Auxili', String(a.targetBib ?? '-'), formatDurationSeconds(a.durationSeconds), fmtTime(a.capturedAt)]),
        styles: { fontSize: 8.5, cellPadding: 1.8 },
        headStyles: { fillColor: [34, 197, 94], textColor: [255, 255, 255] },
        didDrawPage: () => pageFooter(doc)
      })
      y = (doc as any).lastAutoTable.finalY + 8
    } else {
      y += 8
    }
  }

  savePdfDoc(doc, `FaltesMN_${meta.competitionCode}_DORSALS.pdf`, options)
}

function addSectionTitle(doc: any, title: string, startY: number) {
  doc.setDrawColor(17, 24, 39)
  doc.setLineWidth(0.5)
  doc.line(14, startY, 196, startY)
  doc.line(14, startY + 1.4, 196, startY + 1.4)
  doc.setFontSize(10)
  doc.setFont(undefined, 'bold')
  doc.text(title, 14, startY + 7)
  doc.setFont(undefined, 'normal')
  return startY + 10
}

function addBibSection(doc: any, title: string, rows: ClassificationBibRow[], startY: number) {
  const tableStartY = addSectionTitle(doc, title, startY)
  ;(doc as any).autoTable({
    startY: tableStartY,
    head: [['Dorsal', 'Participant']],
    body: rows.map((row) => [String(row.bib), row.fullName || '']),
    styles: { fontSize: 9, cellPadding: 2, valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 150 },
    },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    didDrawPage: () => pageFooter(doc)
  })
  return (doc as any).lastAutoTable.finalY + 6
}

export async function exportClassificationPdf(meta: PdfMeta & { title: string }, sections: ClassificationSections, options?: PdfSaveOptions) {
  const mod = await import('jspdf')
  const { jsPDF } = mod as any
  await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })

  doc.setFontSize(14)
  doc.text(`FaltesMN - Classificació`, 14, 14)
  doc.setFontSize(11)
  doc.text(`Competició: ${meta.competitionName} (${meta.competitionCode})`, 14, 22)
  doc.text(`Llistat: ${meta.title}`, 14, 28)
  doc.text(`Generat: ${fmtGeneratedAt(meta.generatedAt)}`, 14, 34)

  const finishedBody = sections.finished.map((row, idx) => [
    String(idx + 1),
    String(row.bib),
    row.fullName || '',
    row.gender || '',
    row.category || '',
    row.grossTime || '',
    row.penaltyTimeEffective || '00:00',
    row.bonusTimeEffective || '00:00',
    row.netTimeEffective || computeNetTime(row.grossTime, row.penaltyTimeEffective, row.bonusTimeEffective) || '',
  ])

  if (finishedBody.length) {
    ;(doc as any).autoTable({
      startY: 40,
      head: [['Pos.', 'Dorsal', 'Participant', 'Gèn.', 'Categoria', 'Temps brut', 'Penal.', 'Bonif.', 'Temps net']],
      body: finishedBody,
      styles: { fontSize: 8.2, cellPadding: 1.8, valign: 'middle' },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 16, halign: 'center' },
        2: { cellWidth: 46 },
        3: { cellWidth: 12, halign: 'center' },
        4: { cellWidth: 24 },
        5: { cellWidth: 23, halign: 'center' },
        6: { cellWidth: 18, halign: 'center' },
        7: { cellWidth: 18, halign: 'center' },
        8: { cellWidth: 23, halign: 'center', fontStyle: 'bold' },
      },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      didParseCell: (hookData: any) => {
        if (hookData.section !== 'body') return
        const col = hookData.column.index
        const value = String(hookData.cell.raw || '')
        if (col === 6 && value && value !== '00:00') {
          hookData.cell.styles.textColor = [185, 28, 28]
          hookData.cell.styles.fontStyle = 'bold'
        }
        if (col === 7 && value && value !== '00:00') {
          hookData.cell.styles.textColor = [21, 128, 61]
          hookData.cell.styles.fontStyle = 'bold'
        }
      },
      didDrawPage: () => pageFooter(doc)
    })
  } else {
    addSectionTitle(doc, 'NO HI HA PARTICIPANTS CLASSIFICATS AMB TEMPS FINAL.', 40)
  }

  let y = finishedBody.length ? (doc as any).lastAutoTable.finalY + 8 : 56
  if (sections.expelled.length) y = addBibSection(doc, 'PARTICIPANTS EXPULSATS', sections.expelled, y)
  if (sections.withdrawn.length) y = addBibSection(doc, 'PARTICIPANTS RETIRATS', sections.withdrawn, y)
  if (sections.noShows.length) y = addBibSection(doc, 'PARTICIPANTS NO PRESENTATS', sections.noShows, y)

  const safeTitle = meta.title.replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]+/gu, '')
  savePdfDoc(doc, `FaltesMN_${meta.competitionCode}_${safeTitle || 'CLASSIFICACIO'}.pdf`, options)
}

export async function exportBibNamePdf(meta: PdfMeta & { title: string; showGenderCategory?: boolean; showOrder?: boolean; emptyMessage?: string }, rows: Array<{ bib: number; fullName: string; gender?: string; category?: string }>, options?: PdfSaveOptions) {
  const mod = await import('jspdf')
  const { jsPDF } = mod as any
  await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })

  doc.setFontSize(14)
  doc.text(`FaltesMN - ${meta.title}`, 14, 14)
  doc.setFontSize(11)
  doc.text(`Competició: ${meta.competitionName} (${meta.competitionCode})`, 14, 22)
  doc.text(`Generat: ${fmtGeneratedAt(meta.generatedAt)}`, 14, 28)

  const showGenderCategory = meta.showGenderCategory !== false
  const showOrder = meta.showOrder !== false
  const body = rows.map((row, idx) => showGenderCategory
    ? (showOrder ? [String(idx + 1), String(row.bib), row.fullName || '', row.gender || '', row.category || ''] : [String(row.bib), row.fullName || '', row.gender || '', row.category || ''])
    : (showOrder ? [String(idx + 1), String(row.bib), row.fullName || ''] : [String(row.bib), row.fullName || ''])
  )

  if (body.length) {
    ;(doc as any).autoTable({
      startY: 34,
      head: [showGenderCategory ? (showOrder ? ['Pos.', 'Dorsal', 'Participant', 'Gèn.', 'Categoria'] : ['Dorsal', 'Participant', 'Gèn.', 'Categoria']) : (showOrder ? ['Pos.', 'Dorsal', 'Participant'] : ['Dorsal', 'Participant'])],
      body,
      styles: { fontSize: 9, cellPadding: 2, valign: 'middle' },
      columnStyles: showGenderCategory ? (showOrder ? {
        0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 92 },
        3: { cellWidth: 14, halign: 'center' },
        4: { cellWidth: 42 },
      } : {
        0: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 106 },
        2: { cellWidth: 14, halign: 'center' },
        3: { cellWidth: 42 },
      }) : (showOrder ? {
        0: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 22, halign: 'center' },
        2: { cellWidth: 140 },
      } : {
        0: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 156 },
      }),
      alternateRowStyles: { fillColor: [245, 245, 245] },
      didDrawPage: () => pageFooter(doc)
    })
  } else {
    addSectionTitle(doc, (meta.emptyMessage || 'NO HI HA DADES PER A AQUEST LLISTAT.').toUpperCase(), 34)
  }

  const safeTitle = meta.title.replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]+/gu, '')
  savePdfDoc(doc, `FaltesMN_${meta.competitionCode}_${safeTitle || 'LLISTAT'}.pdf`, options)
}
