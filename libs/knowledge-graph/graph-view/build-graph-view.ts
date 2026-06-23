import type { Edge } from "../edge.js";
import type { GraphReadResult } from "../service.js";
import type { Component, Source } from "../schema.js";
import type { ClaimProvenanceRecord } from "../../storage/sqlite/repository.js";

export interface GraphViewComponentRow {
  id: string;
  name: string;
  folder: string;
  anchors: string[];
  flowCount: number;
  claimCount: number;
}

export interface GraphViewClaimRow {
  id: string;
  text: string;
  kind: string;
  session: string;
  createdAt: string | null;
  memoryCommitId: string | null;
}

export interface GraphViewTimelineEvent {
  memoryCommitId: string | null;
  createdAt: string | null;
  added: number;
  sessionPct: number;
  codePct: number;
}

export interface GraphViewData {
  generatedAt: string;
  counts: {
    components: number;
    flows: number;
    claims: number;
  };
  components: GraphViewComponentRow[];
  claims: GraphViewClaimRow[];
  claimsTimeline: {
    summary: { total: number; sessionPct: number; codePct: number };
    events: GraphViewTimelineEvent[];
  };
}

export interface BuildGraphViewOptions {
  repoName?: string;
}

export function buildGraphViewData(
  graph: GraphReadResult,
  provenance: ClaimProvenanceRecord[],
): GraphViewData {
  const provenanceByClaimId = new Map(provenance.map((row) => [row.claim_id, row]));
  const sourceById = new Map(graph.sources.map((source) => [source.id, source]));
  const topLevelComponents = selectTopLevelComponents(graph.components, graph.edges);
  const components = topLevelComponents.map((component) => ({
    id: component.id,
    name: component.name,
    folder: segmentForComponentId(component.id),
    anchors: parseAnchors(component.code_anchor),
    flowCount: countFlowsForComponent(component.id, graph.edges),
    claimCount: countClaimsForComponent(component.id, graph.edges),
  }));

  const claims = graph.claims
    .map((claim) => {
      const record = provenanceByClaimId.get(claim.id);
      return {
        id: claim.id,
        text: claim.text,
        kind: claim.kind,
        session: sessionLabelForClaim(claim.id, graph.edges, sourceById),
        createdAt: record?.created_at ?? null,
        memoryCommitId: record?.memory_commit_id ?? null,
      };
    })
    .sort((left, right) => {
      const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
      const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
      return rightTime - leftTime;
    });

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      components: components.length,
      flows: graph.flows.length,
      claims: claims.length,
    },
    components,
    claims,
    claimsTimeline: buildClaimsTimeline(claims),
  };
}

export function buildGraphViewHtml(
  graph: GraphReadResult,
  provenance: ClaimProvenanceRecord[],
  options: BuildGraphViewOptions = {},
): string {
  const data = buildGraphViewData(graph, provenance);
  const title = options.repoName ? `Greplica graph view — ${options.repoName}` : "Greplica graph view";
  return renderHtml(data, title);
}

function selectTopLevelComponents(components: Component[], edges: Edge[]): Component[] {
  const componentIds = new Set(components.map((component) => component.id));
  const childIds = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "contains" || edge.from_type !== "component" || edge.to_type !== "component") continue;
    if (!componentIds.has(edge.from_id) || !componentIds.has(edge.to_id)) continue;
    childIds.add(edge.to_id);
  }
  return sortByName(components.filter((component) => !childIds.has(component.id)));
}

function countFlowsForComponent(componentId: string, edges: Edge[]): number {
  return edges.filter((edge) => edge.kind === "touches" && edge.to_type === "component" && edge.to_id === componentId).length;
}

function countClaimsForComponent(componentId: string, edges: Edge[]): number {
  return edges.filter((edge) => edge.kind === "about" && edge.to_type === "component" && edge.to_id === componentId).length;
}

function parseAnchors(codeAnchor: string | undefined): string[] {
  if (codeAnchor === undefined || codeAnchor.trim().length === 0) return [];
  return codeAnchor
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function segmentForComponentId(id: string): string {
  const withoutPrefix = id.startsWith("component.") ? id.slice("component.".length) : id;
  const slugged = withoutPrefix
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slugged.length > 0 ? slugged : `component-${id.slice(0, 8)}`;
}

function sessionLabelForClaim(claimId: string, edges: Edge[], sourceById: Map<string, Source>): string {
  const evidenceEdges = edges.filter(
    (edge) => edge.kind === "evidenced_by" && edge.from_type === "claim" && edge.from_id === claimId && edge.to_type === "source",
  );
  if (evidenceEdges.length === 0) return "from code";

  const labels = evidenceEdges
    .map((edge) => {
      const source = sourceById.get(edge.to_id);
      if (!source) return undefined;
      return source.title?.trim() || source.ref?.trim();
    })
    .filter((label): label is string => label !== undefined && label.length > 0);

  return labels.length > 0 ? labels.join("; ") : "from code";
}

function isFromSession(session: string): boolean {
  return session !== "from code";
}

function percent(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

function buildClaimsTimeline(claims: GraphViewClaimRow[]): GraphViewData["claimsTimeline"] {
  const batches = new Map<string, { memoryCommitId: string | null; createdAt: string | null; claims: GraphViewClaimRow[] }>();
  for (const claim of claims) {
    const key = claim.memoryCommitId ?? claim.createdAt ?? "unknown";
    if (!batches.has(key)) {
      batches.set(key, {
        memoryCommitId: claim.memoryCommitId,
        createdAt: claim.createdAt,
        claims: [],
      });
    }
    batches.get(key)?.claims.push(claim);
  }

  const sorted = [...batches.values()].sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
    return leftTime - rightTime;
  });

  const events = sorted.map((batch) => {
    const added = batch.claims.length;
    const sessionCount = batch.claims.filter((claim) => isFromSession(claim.session)).length;
    const codeCount = added - sessionCount;
    return {
      memoryCommitId: batch.memoryCommitId,
      createdAt: batch.createdAt,
      added,
      sessionPct: percent(sessionCount, added),
      codePct: percent(codeCount, added),
    };
  });

  const total = claims.length;
  const totalSession = claims.filter((claim) => isFromSession(claim.session)).length;
  const totalCode = total - totalSession;

  return {
    summary: {
      total,
      sessionPct: percent(totalSession, total),
      codePct: percent(totalCode, total),
    },
    events: [...events].reverse(),
  };
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(data: GraphViewData, title: string): string {
  const componentRows = data.components
    .map((component) => {
      const anchors =
        component.anchors.length > 0
          ? component.anchors.map((anchor) => `<code>${escapeHtml(anchor)}</code>`).join("<br>")
          : '<span class="muted">—</span>';
      return `          <tr data-id="${escapeHtml(component.id)}"><td class="folder">${escapeHtml(component.folder)}</td><td>${escapeHtml(component.name)}</td><td class="anchors">${anchors}</td><td class="count">${component.flowCount}</td><td class="count">${component.claimCount}</td></tr>`;
    })
    .join("\n");

  const claimRows = data.claims
    .map(
      (claim) =>
        `          <tr data-id="${escapeHtml(claim.id)}" data-memory-commit-id="${escapeHtml(claim.memoryCommitId ?? "")}"><td class="claim-text">${escapeHtml(claim.text)}<div class="claim-id"><code>${escapeHtml(claim.id)}</code></div></td><td class="session">${escapeHtml(claim.session)}</td><td class="created">${escapeHtml(formatDateTime(claim.createdAt))}</td></tr>`,
    )
    .join("\n");

  const timeline = data.claimsTimeline;
  const timelineEvents = timeline.events
    .map((event) => {
      const commitHref = event.memoryCommitId ? `#claims?commit=${encodeURIComponent(event.memoryCommitId)}` : "#claims";
      return `          <li class="timeline-event">
            <div class="timeline-marker" aria-hidden="true"></div>
            <a class="timeline-link" href="${commitHref}">
              <div class="timeline-body">
                <div class="timeline-date">${escapeHtml(formatDateTime(event.createdAt))}</div>
                <div class="timeline-stat">${event.added} claim${event.added === 1 ? "" : "s"} added (${event.sessionPct}% from session, ${event.codePct}% from code)</div>
              </div>
            </a>
          </li>`;
    })
    .join("\n");

  const defaultClaimsMeta = `${data.claims.length} active claims · session from evidenced_by source, otherwise from code`;
  const graphDataJson = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #f4f5f7;
      --panel: #ffffff;
      --text: #1a1d26;
      --muted: #5c6573;
      --line: #d8dde6;
      --accent: #2f6fed;
      --accent-soft: #e8f0ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .layout {
      display: grid;
      grid-template-columns: 220px 1fr;
      min-height: 100vh;
    }
    nav {
      background: var(--panel);
      border-right: 1px solid var(--line);
      padding: 1.5rem 1rem;
    }
    nav h1 {
      font-size: 0.95rem;
      margin: 0 0 1rem;
      color: var(--muted);
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    nav a {
      display: block;
      padding: 0.55rem 0.75rem;
      border-radius: 8px;
      color: var(--text);
      text-decoration: none;
      font-size: 0.95rem;
    }
    nav a:hover { background: var(--bg); }
    nav a.active {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
    }
    main { padding: 2rem; }
    .view { display: none; }
    .view.active { display: block; }
    .view h2 {
      margin: 0 0 0.35rem;
      font-size: 1.5rem;
    }
    .view .meta {
      color: var(--muted);
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
    }
    table {
      width: 100%;
      max-width: 1200px;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
    }
    table.claims-table { max-width: 1400px; }
    th, td {
      text-align: left;
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--line);
    }
    th {
      background: #f8f9fb;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: #fafbfc; }
    td.folder {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.88rem;
      color: var(--muted);
      white-space: nowrap;
    }
    td.anchors {
      font-size: 0.82rem;
      line-height: 1.45;
      min-width: 200px;
    }
    td.anchors code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #3a4250;
      word-break: break-all;
    }
    td.count {
      text-align: center;
      font-variant-numeric: tabular-nums;
      color: var(--muted);
      width: 4.5rem;
    }
    th.count { text-align: center; width: 4.5rem; }
    td.claim-text { min-width: 320px; }
    td.claim-text .claim-id {
      margin-top: 0.35rem;
      font-size: 0.78rem;
      color: var(--muted);
    }
    td.claim-text .claim-id code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    td.session { min-width: 180px; font-size: 0.9rem; }
    td.created {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      font-size: 0.88rem;
      color: var(--muted);
    }
    .muted { color: var(--muted); }
    .timeline {
      max-width: 720px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .timeline-summary {
      display: grid;
      grid-template-columns: 1.25rem 1fr;
      gap: 1rem;
      align-items: start;
      margin-bottom: 0.5rem;
    }
    .timeline-summary-marker {
      width: 1.25rem;
      height: 1.25rem;
      margin-top: 0.2rem;
      border-radius: 50%;
      background: var(--accent);
      border: 3px solid var(--panel);
      box-shadow: 0 0 0 2px var(--accent);
    }
    .timeline-summary-body {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 1rem 1.1rem;
    }
    .timeline-summary-label {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin-bottom: 0.25rem;
    }
    .timeline-summary-stat {
      font-size: 1.05rem;
      font-weight: 600;
    }
    .timeline-events {
      margin: 0;
      padding: 0 0 0 0.45rem;
      list-style: none;
      border-left: 2px solid var(--line);
    }
    .timeline-event {
      display: grid;
      grid-template-columns: 1.25rem 1fr;
      gap: 1rem;
      align-items: start;
      padding-bottom: 1.35rem;
      position: relative;
      margin-left: -0.55rem;
    }
    .timeline-event:last-child { padding-bottom: 0; }
    .timeline-marker {
      width: 0.85rem;
      height: 0.85rem;
      margin-top: 0.35rem;
      margin-left: 0.2rem;
      border-radius: 50%;
      background: var(--panel);
      border: 2px solid var(--accent);
      box-shadow: 0 0 0 2px var(--bg);
    }
    .timeline-body {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 0.8rem 1rem;
    }
    a.timeline-link {
      color: inherit;
      text-decoration: none;
      display: block;
    }
    a.timeline-link:hover .timeline-body,
    a.timeline-link:focus-visible .timeline-body {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-soft);
    }
    a.timeline-summary-link {
      color: inherit;
      text-decoration: none;
      display: block;
    }
    a.timeline-summary-link:hover .timeline-summary-body,
    a.timeline-summary-link:focus-visible .timeline-summary-body {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-soft);
    }
    .claims-meta .filter-clear {
      margin-left: 0.5rem;
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
    }
    .claims-meta .filter-clear:hover { text-decoration: underline; }
    tr.claim-row-hidden { display: none; }
    tr.claim-row-highlight td { background: var(--accent-soft) !important; }
    .timeline-date {
      font-size: 0.82rem;
      color: var(--muted);
      margin-bottom: 0.2rem;
    }
    .timeline-stat {
      font-size: 0.95rem;
    }
    .claim-kinds-layout {
      display: flex;
      flex-wrap: wrap;
      gap: 2.5rem;
      align-items: flex-start;
      max-width: 900px;
    }
    .claim-kinds-chart-wrap {
      flex: 0 0 auto;
    }
    .claim-kinds-chart {
      display: block;
    }
    .claim-kinds-chart .pie-slice {
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .claim-kinds-chart a:hover .pie-slice,
    .claim-kinds-chart a:focus-visible .pie-slice {
      opacity: 0.85;
    }
    .claim-kinds-legend {
      flex: 1 1 220px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .claim-kinds-legend li { margin-bottom: 0.65rem; }
    .claim-kinds-legend a {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      color: var(--text);
      text-decoration: none;
      font-size: 0.95rem;
      padding: 0.35rem 0.5rem;
      border-radius: 8px;
    }
    .claim-kinds-legend a:hover {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .claim-kinds-swatch {
      width: 0.85rem;
      height: 0.85rem;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .claim-kinds-legend .kind-label {
      font-weight: 600;
      min-width: 5.5rem;
    }
    .claim-kinds-legend .kind-stat {
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    @media (max-width: 720px) {
      .layout { grid-template-columns: 1fr; }
      nav { border-right: none; border-bottom: 1px solid var(--line); }
    }
  </style>
</head>
<body>
  <div class="layout">
    <nav>
      <h1>Views</h1>
      <a href="#components" data-view="components">Components</a>
      <a href="#claims" data-view="claims">Claims</a>
      <a href="#claim-kinds" data-view="claim-kinds">Claim Kinds</a>
      <a href="#claims-timeline" data-view="claims-timeline">Claims - Timeline</a>
    </nav>
    <main>
      <section id="view-components" class="view" data-view="components">
        <h2>Components</h2>
        <p class="meta">${data.components.length} top-level components</p>
        <table>
          <thead>
            <tr><th>Folder</th><th>Name</th><th>Anchors</th><th class="count">Flows</th><th class="count">Claims</th></tr>
          </thead>
          <tbody>
${componentRows}
          </tbody>
        </table>
      </section>
      <section id="view-claims" class="view" data-view="claims">
        <h2>Claims</h2>
        <p class="meta claims-meta" id="claims-meta">${escapeHtml(defaultClaimsMeta)}</p>
        <table class="claims-table" id="claims-table">
          <thead>
            <tr><th>Claim</th><th>Session</th><th>Created</th></tr>
          </thead>
          <tbody>
${claimRows}
          </tbody>
        </table>
      </section>
      <section id="view-claim-kinds" class="view" data-view="claim-kinds">
        <h2>Claim Kinds</h2>
        <p class="meta" id="claim-kinds-meta">Active claims by kind · click a slice to filter Claims</p>
        <div class="claim-kinds-layout">
          <div class="claim-kinds-chart-wrap">
            <svg id="claim-kinds-chart" class="claim-kinds-chart" width="320" height="320" viewBox="0 0 320 320" role="img" aria-label="Pie chart of claim kinds"></svg>
          </div>
          <ul class="claim-kinds-legend" id="claim-kinds-legend"></ul>
        </div>
      </section>
      <section id="view-claims-timeline" class="view" data-view="claims-timeline">
        <h2>Claims - Timeline</h2>
        <p class="meta">${timeline.events.length} memory commits · newest batches first</p>
        <div class="timeline">
          <div class="timeline-summary">
            <div class="timeline-summary-marker" aria-hidden="true"></div>
            <a class="timeline-summary-link" href="#claims">
              <div class="timeline-summary-body">
                <div class="timeline-summary-label">Cumulative to date</div>
                <div class="timeline-summary-stat">${timeline.summary.total} claims (${timeline.summary.sessionPct}% from session, ${timeline.summary.codePct}% from code)</div>
              </div>
            </a>
          </div>
          <ol class="timeline-events">
${timelineEvents}
          </ol>
        </div>
      </section>
    </main>
  </div>
  <script id="graph-data" type="application/json">${graphDataJson}</script>
  <script>
    const graphData = JSON.parse(document.getElementById("graph-data").textContent);
    const links = document.querySelectorAll("nav a[data-view]");
    const views = document.querySelectorAll(".view[data-view]");
    const claimRows = document.querySelectorAll("#claims-table tbody tr[data-memory-commit-id]");
    const claimsMeta = document.getElementById("claims-meta");
    const claimsView = document.getElementById("view-claims");
    const defaultClaimsMeta = ${JSON.stringify(defaultClaimsMeta)};

    const claimKindById = new Map(graphData.claims.map((claim) => [claim.id, claim.kind]));
    for (const row of claimRows) {
      row.dataset.kind = claimKindById.get(row.dataset.id) ?? "";
    }

    const CLAIM_KIND_ORDER = ["fact", "decision", "requirement", "task", "risk", "question"];
    const CLAIM_KIND_COLORS = {
      fact: "#2f6fed",
      decision: "#0f8a5f",
      requirement: "#c99700",
      task: "#8b5cf6",
      risk: "#e4572e",
      question: "#ec4899",
    };

    function aggregateClaimKindCounts() {
      const counts = Object.fromEntries(CLAIM_KIND_ORDER.map((kind) => [kind, 0]));
      for (const claim of graphData.claims) {
        if (counts[claim.kind] !== undefined) counts[claim.kind] += 1;
        else counts[claim.kind] = 1;
      }
      return counts;
    }

    function pieSlicePath(cx, cy, r, startAngle, endAngle) {
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
      return "M " + cx + " " + cy + " L " + x1 + " " + y1 + " A " + r + " " + r + " 0 " + largeArc + " 1 " + x2 + " " + y2 + " Z";
    }

    function renderClaimKindsChart() {
      const svg = document.getElementById("claim-kinds-chart");
      const legend = document.getElementById("claim-kinds-legend");
      const meta = document.getElementById("claim-kinds-meta");
      if (!svg || !legend) return;

      const counts = aggregateClaimKindCounts();
      const total = graphData.claims.length;
      const slices = CLAIM_KIND_ORDER.filter((kind) => counts[kind] > 0);
      const cx = 160;
      const cy = 160;
      const r = 130;
      let angle = -Math.PI / 2;

      const svgParts = [];
      for (const kind of slices) {
        const count = counts[kind];
        const sliceAngle = (count / total) * Math.PI * 2;
        const endAngle = angle + sliceAngle;
        const path = pieSlicePath(cx, cy, r, angle, endAngle);
        const pct = Math.round((count / total) * 100);
        const href = "#claims?kind=" + encodeURIComponent(kind);
        const mid = angle + sliceAngle / 2;
        const labelR = r * 0.62;
        const lx = cx + labelR * Math.cos(mid);
        const ly = cy + labelR * Math.sin(mid);
        const showLabel = sliceAngle > 0.25;
        svgParts.push(
          '<a href="' + href + '" class="pie-slice-link">' +
            '<path class="pie-slice" d="' + path + '" fill="' + CLAIM_KIND_COLORS[kind] + '" data-kind="' + kind + '">' +
              '<title>' + kind + ": " + count + " (" + pct + "%)</title>" +
            "</path>" +
          "</a>"
        );
        if (showLabel) {
          svgParts.push(
            '<text x="' + lx + '" y="' + ly + '" text-anchor="middle" dominant-baseline="middle" ' +
              'font-size="11" font-weight="600" fill="#fff" pointer-events="none">' + pct + "%</text>"
          );
        }
        angle = endAngle;
      }
      svg.innerHTML = svgParts.join("");

      legend.innerHTML = slices.map((kind) => {
        const count = counts[kind];
        const pct = Math.round((count / total) * 100);
        const href = "#claims?kind=" + encodeURIComponent(kind);
        return (
          '<li><a href="' + href + '" class="kind-legend-link">' +
            '<span class="claim-kinds-swatch" style="background:' + CLAIM_KIND_COLORS[kind] + '"></span>' +
            '<span class="kind-label">' + escapeHtmlClient(kind) + "</span>" +
            '<span class="kind-stat">' + count + " · " + pct + "%</span>" +
          "</a></li>"
        );
      }).join("");

      if (meta) meta.textContent = total + " active claims · click a slice or legend row to filter Claims";
    }

    function parseHash() {
      const raw = location.hash.replace(/^#/, "") || "components";
      const question = raw.indexOf("?");
      const viewId = question === -1 ? raw : raw.slice(0, question);
      const query = question === -1 ? "" : raw.slice(question + 1);
      const params = new URLSearchParams(query);
      return {
        viewId: viewId || "components",
        commitFilter: viewId === "claims" ? params.get("commit") : null,
        claimFilter: viewId === "claims" ? params.get("claim") : null,
        kindFilter: viewId === "claims" ? params.get("kind") : null,
      };
    }

    function escapeHtmlClient(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function shortCommitId(commitId) {
      if (!commitId) return "";
      return commitId.length > 20 ? commitId.slice(0, 17) + "…" : commitId;
    }

    function formatDateTimeClient(iso) {
      if (!iso) return "";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    function applyClaimsFilter(commitFilter, claimFilter, kindFilter) {
      let visible = 0;
      for (const row of claimRows) {
        const matchesCommit = !commitFilter || row.dataset.memoryCommitId === commitFilter;
        const matchesClaim = !claimFilter || row.dataset.id === claimFilter;
        const matchesKind = !kindFilter || row.dataset.kind === kindFilter;
        const matches = matchesCommit && matchesClaim && matchesKind;
        row.classList.toggle("claim-row-hidden", !matches);
        row.classList.toggle("claim-row-highlight", Boolean(claimFilter && row.dataset.id === claimFilter));
        if (matches) visible += 1;
      }

      if (!commitFilter && !claimFilter && !kindFilter) {
        claimsMeta.textContent = defaultClaimsMeta;
        return;
      }

      if (claimFilter && !commitFilter && !kindFilter) {
        claimsMeta.innerHTML = visible + " claim · <code>" + escapeHtmlClient(claimFilter) + '</code> · <a class="filter-clear" href="#claims">Clear filter</a>';
        return;
      }

      if (kindFilter && !commitFilter && !claimFilter) {
        claimsMeta.innerHTML = visible + " of " + graphData.claims.length + ' claims · kind <code>' + escapeHtmlClient(kindFilter) + '</code> · <a class="filter-clear" href="#claims">Clear filter</a>';
        return;
      }

      const event = graphData.claimsTimeline.events.find((item) => item.memoryCommitId === commitFilter);
      const dateLabel = event ? formatDateTimeClient(event.createdAt) : "";

      if (visible === 0) {
        let emptyMeta = "No matching claims";
        if (commitFilter) emptyMeta += " for commit <code>" + escapeHtmlClient(shortCommitId(commitFilter)) + "</code>";
        if (kindFilter) emptyMeta += (commitFilter ? " ·" : "") + " kind <code>" + escapeHtmlClient(kindFilter) + "</code>";
        claimsMeta.innerHTML = emptyMeta + ' · <a class="filter-clear" href="#claims">Clear filter</a>';
        return;
      }

      let meta = visible + " of " + graphData.claims.length + " claims";
      if (commitFilter) meta += " · commit <code>" + escapeHtmlClient(shortCommitId(commitFilter)) + "</code>";
      if (kindFilter) meta += " · kind <code>" + escapeHtmlClient(kindFilter) + "</code>";
      if (commitFilter && dateLabel) meta += " · " + dateLabel;
      meta += ' · <a class="filter-clear" href="#claims">Clear filter</a>';
      claimsMeta.innerHTML = meta;
    }

    function showView(viewId, commitFilter, claimFilter, kindFilter) {
      for (const link of links) {
        link.classList.toggle("active", link.dataset.view === viewId);
      }
      for (const view of views) view.classList.toggle("active", view.dataset.view === viewId);
      applyClaimsFilter(
        viewId === "claims" ? commitFilter : null,
        viewId === "claims" ? claimFilter : null,
        viewId === "claims" ? kindFilter : null,
      );
      if (viewId === "claim-kinds") {
        renderClaimKindsChart();
      }
      if (viewId === "claims" && (commitFilter || claimFilter || kindFilter)) {
        const target = claimFilter
          ? document.querySelector('#claims-table tbody tr[data-id="' + claimFilter + '"]')
          : null;
        (target ?? claimsView).scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function viewFromHash() {
      const { viewId, commitFilter, claimFilter, kindFilter } = parseHash();
      const resolvedView = [...views].some((view) => view.dataset.view === viewId) ? viewId : "components";
      showView(resolvedView, commitFilter, claimFilter, kindFilter);
    }

    for (const link of links) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        history.replaceState(null, "", "#" + link.dataset.view);
        showView(link.dataset.view, null, null, null);
      });
    }

    document.addEventListener("click", (event) => {
      const clearLink = event.target.closest("a.filter-clear");
      if (clearLink) {
        event.preventDefault();
        history.replaceState(null, "", "#claims");
        showView("claims", null, null, null);
        return;
      }
      const kindLink = event.target.closest("a.pie-slice-link, a.kind-legend-link");
      if (kindLink && kindLink.getAttribute("href")?.startsWith("#")) {
        event.preventDefault();
        const href = kindLink.getAttribute("href").slice(1);
        history.replaceState(null, "", "#" + href);
        viewFromHash();
        return;
      }
      const timelineLink = event.target.closest("a.timeline-link, a.timeline-summary-link");
      if (timelineLink && timelineLink.getAttribute("href")?.startsWith("#")) {
        event.preventDefault();
        const href = timelineLink.getAttribute("href").slice(1);
        history.replaceState(null, "", "#" + href);
        viewFromHash();
      }
    });

    window.addEventListener("hashchange", viewFromHash);
    viewFromHash();
    renderClaimKindsChart();
  </script>
</body>
</html>
`;
}
