import { LineageGraph, LineageNode, LineageEdge, NodeType } from "../services/lineageGraph";
import { LayoutConfig, getLayoutConfig } from "./dagLayout";

/**
 * Accent per node type: used only for the badge, the hover outline and the legend, so the
 * cards themselves stay neutral. Mid-tone hues that read on both dark and light themes.
 */
/* eslint-disable @typescript-eslint/naming-convention */
const NODE_COLORS: Record<NodeType, string> = {
    'SOURCE': '#3b9eff',    // blue
    'CTE': '#a371f7',       // violet
    'TARGET': '#3fb950',    // green
    'RESULT': '#f0883e'     // orange
};

/** Short tag under the badge icon, dbt style. */
const NODE_TAGS: Record<NodeType, string> = {
    'SOURCE': 'SRC',
    'CTE': 'CTE',
    'TARGET': 'TGT',
    'RESULT': 'OUT'
};

/** 16×16 stroke icons: database, cube, table, output arrow. */
const NODE_ICONS: Record<NodeType, string> = {
    'SOURCE': 'M3 4.5c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2z M3 4.5v7c0 1.1 2.2 2 5 2s5-.9 5-2v-7 M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
    'CTE': 'M8 1.8l5.5 3.1v6.2L8 14.2l-5.5-3.1V4.9z M2.5 4.9L8 8l5.5-3.1 M8 8v6.2',
    'TARGET': 'M2.5 3.5h11v9h-11z M2.5 6.5h11 M6.5 6.5v6',
    'RESULT': 'M2.5 8h7 M7 5l3 3-3 3 M12.5 3v10'
};
/* eslint-enable @typescript-eslint/naming-convention */

/** Width of the coloured badge on the left of each card. */
const BADGE_WIDTH = 36;
/** Where the name starts, right of the badge. */
const TEXT_X = BADGE_WIDTH + 10;

/**
 * Render the lineage graph as an SVG string
 */
export function renderGraphToSvg(
    graph: LineageGraph,
    width: number,
    height: number,
    config?: Partial<LayoutConfig>
): string {
    const cfg = getLayoutConfig(config);

    if (graph.nodes.length === 0) {
        return renderEmptyState(width, height);
    }

    const ports = assignPorts(graph, cfg);
    const edges = graph.edges.map(edge => renderEdge(edge, graph.nodes, cfg, ports.get(edge.id))).join('\n');
    const nodes = graph.nodes.map(node => renderNode(node, cfg)).join('\n');

    return `
        <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="lineage-graph" xmlns="http://www.w3.org/2000/svg">
            <!-- Inside the SVG so the PNG/PDF export keeps the font; a font list with quotes cannot go in an attribute -->
            <style>text { font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif); }</style>
            <defs>
                <marker id="arrowhead" viewBox="0 0 10 10" markerWidth="${ARROW_LENGTH}" markerHeight="${ARROW_LENGTH}"
                    refX="0" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vscode-descriptionForeground, #888)" fill-opacity="0.8"/>
                </marker>
                <filter id="card-shadow" x="-10%" y="-20%" width="120%" height="150%">
                    <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.18"/>
                </filter>
            </defs>

            <!-- Edges (rendered first, behind nodes) -->
            <g class="edges">
                ${edges}
            </g>

            <!-- Nodes -->
            <g class="nodes">
                ${nodes}
            </g>
        </svg>
    `;
}

/** The arrowhead's length; the path stops this far short of the box so the tip lands on it. */
const ARROW_LENGTH = 6;
/** Gap between the arrow tip and the target box. */
const ARROW_GAP = 2;
/** Vertical distance between neighbouring edge ends on one side of a box. */
const PORT_SPACING = 10;

/**
 * Where each edge leaves its source and enters its target. Edges on the same side of a box are
 * spread out, ordered by where they come from / go to, so arrowheads never stack and
 * neighbouring edges do not cross right at the box.
 */
function assignPorts(graph: LineageGraph, cfg: LayoutConfig): Map<string, { y1: number; y2: number }> {
    const byId = new Map(graph.nodes.map(n => [n.id, n] as const));
    const center = (n: LineageNode) => n.y! + cfg.nodeHeight / 2;
    // The point each edge heads for right after leaving / right before entering
    const next = (e: LineageEdge) => e.waypoints?.[0]?.y ?? center(byId.get(e.target)!);
    const prev = (e: LineageEdge) => e.waypoints?.[e.waypoints.length - 1]?.y ?? center(byId.get(e.source)!);

    const drawable = graph.edges.filter(e => byId.get(e.source)?.y !== undefined && byId.get(e.target)?.y !== undefined);
    const ports = new Map<string, { y1: number; y2: number }>();
    drawable.forEach(e => ports.set(e.id, { y1: 0, y2: 0 }));

    const spread = (edges: LineageEdge[], node: LineageNode, key: (e: LineageEdge) => number, end: 'y1' | 'y2') => {
        const sorted = edges.slice().sort((a, b) => key(a) - key(b));
        const step = sorted.length > 1 ? Math.min(PORT_SPACING, (cfg.nodeHeight - 16) / (sorted.length - 1)) : 0;
        sorted.forEach((e, i) => { ports.get(e.id)![end] = center(node) + (i - (sorted.length - 1) / 2) * step; });
    };
    for (const node of graph.nodes) {
        if (node.y === undefined) { continue; }
        spread(drawable.filter(e => e.source === node.id), node, next, 'y1');
        spread(drawable.filter(e => e.target === node.id), node, prev, 'y2');
    }
    return ports;
}

/**
 * Render a single edge: right side of the source to left side of the target, through the lane
 * it was given in every layer it skips.
 */
function renderEdge(edge: LineageEdge, nodes: LineageNode[], cfg: LayoutConfig, port?: { y1: number; y2: number }): string {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);

    if (!sourceNode || !targetNode || sourceNode.x === undefined || targetNode.x === undefined || !port) {
        return '';
    }

    const path = edgePath(
        { x: sourceNode.x + cfg.nodeWidth, y: port.y1 },
        { x: targetNode.x! - ARROW_GAP - ARROW_LENGTH, y: port.y2 },
        edge.waypoints ?? [],
        cfg.nodeWidth
    );

    return `
        <path
            d="${path}"
            class="edge"
            fill="none"
            stroke="var(--vscode-descriptionForeground, #888)"
            stroke-opacity="0.55"
            stroke-width="1.25"
            marker-end="url(#arrowhead)"
            data-source="${escapeAttr(edge.source)}"
            data-target="${escapeAttr(edge.target)}"
        />
    `;
}

/**
 * SVG path: horizontal-tangent cubic curves between columns, straight runs across each skipped
 * column. Every curve leaves and arrives horizontally, so edges read left-to-right and the
 * arrowhead always points straight into the box.
 */
export function edgePath(
    start: { x: number; y: number },
    end: { x: number; y: number },
    waypoints: Array<{ x: number; y: number }>,
    columnWidth: number
): string {
    const r = (v: number) => Math.round(v * 10) / 10;
    const parts = [`M ${r(start.x)} ${r(start.y)}`];
    let at = start;
    const curveTo = (to: { x: number; y: number }) => {
        if (Math.abs(to.y - at.y) < 0.5) {
            parts.push(`L ${r(to.x)} ${r(to.y)}`);
        } else {
            const mid = (to.x - at.x) / 2;
            parts.push(`C ${r(at.x + mid)} ${r(at.y)}, ${r(to.x - mid)} ${r(to.y)}, ${r(to.x)} ${r(to.y)}`);
        }
        at = to;
    };
    for (const w of waypoints) {
        curveTo({ x: w.x, y: w.y });
        parts.push(`L ${r(w.x + columnWidth)} ${r(w.y)}`);
        at = { x: w.x + columnWidth, y: w.y };
    }
    curveTo(end);
    return parts.join(' ');
}

/**
 * Render a single node
 */
function renderNode(node: LineageNode, cfg: LayoutConfig): string {
    if (node.x === undefined || node.y === undefined) {
        return '';
    }

    const color = NODE_COLORS[node.nodeType];
    const w = cfg.nodeWidth, h = cfg.nodeHeight, r = 6;
    const subtitle = nodeSubtitle(node);
    const textWidth = w - TEXT_X - 10;
    // Name and subtitle stacked, or the name alone centred
    const nameY = subtitle ? h / 2 - 3 : h / 2 + 4;

    return `
        <g class="node node-${node.nodeType.toLowerCase()}"
           transform="translate(${node.x}, ${node.y})"
           data-id="${escapeAttr(node.id)}"
           data-type="${escapeAttr(node.nodeType)}"
           data-fullname="${escapeAttr(node.fullName)}"
           ${node.sourceLine ? `data-line="${node.sourceLine}"` : ''}
           ${node.sourceColumn ? `data-column="${node.sourceColumn}"` : ''}>
            <title>${escapeHtml(node.fullName)}${node.statementType ? ` (${escapeHtml(node.statementType)})` : ''}</title>
            <rect class="node-rect" width="${w}" height="${h}" rx="${r}" ry="${r}"
                fill="var(--vscode-editorWidget-background, #252526)"
                stroke="var(--vscode-editorWidget-border, #454545)" stroke-width="1"
                filter="url(#card-shadow)"/>
            <path d="M ${r} 0.5 H ${BADGE_WIDTH} V ${h - 0.5} H ${r} Q 0.5 ${h - 0.5} 0.5 ${h - r} V ${r} Q 0.5 0.5 ${r} 0.5 Z"
                fill="${color}" fill-opacity="0.14"/>
            <g transform="translate(${(BADGE_WIDTH - 16) / 2}, ${h / 2 - 14})" fill="none" stroke="${color}"
                stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="${NODE_ICONS[node.nodeType]}"/>
            </g>
            <text x="${BADGE_WIDTH / 2}" y="${h / 2 + 13}" text-anchor="middle" font-size="8" font-weight="700"
                letter-spacing="0.4" fill="${color}" class="node-tag">${NODE_TAGS[node.nodeType]}</text>
            <text x="${TEXT_X}" y="${nameY}" class="node-name" font-size="12.5" font-weight="600"
                fill="var(--vscode-foreground, #ccc)">${escapeHtml(fitText(node.name, textWidth, 6.9))}</text>
            ${subtitle ? `<text x="${TEXT_X}" y="${h / 2 + 11}" class="node-type" font-size="10.5"
                fill="var(--vscode-descriptionForeground, #888)">${escapeHtml(fitText(subtitle, textWidth, 5.9))}</text>` : ''}
        </g>
    `;
}

/**
 * Render empty state when no nodes
 */
function renderEmptyState(width: number, height: number): string {
    return `
        <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="lineage-graph" xmlns="http://www.w3.org/2000/svg">
            <text
                x="${width / 2}"
                y="${height / 2}"
                text-anchor="middle"
                fill="var(--vscode-descriptionForeground, #888)"
                font-size="14">
                No lineage data detected
            </text>
        </svg>
    `;
}

/**
 * Second line of a card: where a table lives (`raw`, `db.schema`) and, for targets, how it is
 * written. CTEs and the query result need none.
 */
function nodeSubtitle(node: LineageNode): string {
    const parts = node.fullName.split('.');
    const qualifier = parts.slice(0, -1).join('.');
    if (node.nodeType === 'TARGET') {
        return [node.statementType, qualifier].filter(Boolean).join(' · ');
    }
    return node.nodeType === 'SOURCE' ? qualifier : '';
}

/** Cut `text` with an ellipsis to fit `maxWidth` px, from an average glyph width for the font size. */
export function fitText(text: string, maxWidth: number, charWidth: number): string {
    const max = Math.floor(maxWidth / charWidth);
    return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + '\u2026';
}

/**
 * Escape HTML entities
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Escape attribute value
 */
function escapeAttr(text: string): string {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Get CSS styles for the lineage graph
 */
export function getGraphStyles(): string {
    return `
        .lineage-graph {
            display: block;
            min-height: 200px;
        }

        .edge, .node {
            transition: opacity 0.15s, stroke 0.15s, stroke-opacity 0.15s;
        }

        .edge:hover {
            stroke: var(--vscode-focusBorder, #007acc);
            stroke-opacity: 1;
            stroke-width: 2;
        }

        .node {
            cursor: pointer;
        }

        .node-rect {
            transition: stroke 0.15s;
        }

        .node-source:hover .node-rect { stroke: ${NODE_COLORS.SOURCE}; }
        .node-cte:hover .node-rect { stroke: ${NODE_COLORS.CTE}; }
        .node-target:hover .node-rect { stroke: ${NODE_COLORS.TARGET}; }
        .node-result:hover .node-rect { stroke: ${NODE_COLORS.RESULT}; }

        .node-name, .node-type, .node-tag {
            pointer-events: none;
        }

        /* Hovering a node: its upstream and downstream stay, everything else fades */
        .lineage-graph.focus .node:not(.related) { opacity: 0.3; }
        .lineage-graph.focus .edge:not(.related) { opacity: 0.12; }
        .lineage-graph.focus .edge.related {
            stroke: var(--vscode-focusBorder, #007acc);
            stroke-opacity: 1;
            stroke-width: 1.75;
        }
    `;
}

/**
 * Generate legend HTML
 */
export function renderLegend(): string {
    const item = (type: NodeType, label: string) => `
            <div class="legend-item">
                <span class="legend-tag" style="color: ${NODE_COLORS[type]}; background: ${NODE_COLORS[type]}24">${NODE_TAGS[type]}</span>
                <span>${label}</span>
            </div>`;
    return `
        <div class="legend">${item('SOURCE', 'Source table')}${item('CTE', 'CTE')}${item('TARGET', 'Target table')}${item('RESULT', 'Query result')}
        </div>
    `;
}
