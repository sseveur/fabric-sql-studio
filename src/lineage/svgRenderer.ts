import { LineageGraph, LineageNode, LineageEdge, NodeType } from "../services/lineageGraph";
import { LayoutConfig, getLayoutConfig } from "./dagLayout";

/**
 * Node colors by type (dbt-inspired palette)
 */
/* eslint-disable @typescript-eslint/naming-convention */
const NODE_COLORS: Record<NodeType, string> = {
    'SOURCE': '#3794ff',    // Blue
    'CTE': '#9b59b6',       // Purple
    'TARGET': '#89d185',    // Green
    'RESULT': '#f0a030'     // Orange - for SELECT query results
};
/* eslint-enable @typescript-eslint/naming-convention */

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
            <defs>
                <marker id="arrowhead" viewBox="0 0 10 10" markerWidth="${ARROW_LENGTH}" markerHeight="${ARROW_LENGTH}"
                    refX="0" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--vscode-descriptionForeground, #888)"/>
                </marker>
                <!-- Glow filter for hover effect -->
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
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
const ARROW_LENGTH = 8;
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
            stroke="var(--vscode-descriptionForeground, #666)"
            stroke-width="2"
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
    const typeLabel = getTypeLabel(node);

    return `
        <g class="node node-${node.nodeType.toLowerCase()}"
           transform="translate(${node.x}, ${node.y})"
           data-id="${escapeAttr(node.id)}"
           data-type="${escapeAttr(node.nodeType)}"
           data-fullname="${escapeAttr(node.fullName)}"
           ${node.sourceLine ? `data-line="${node.sourceLine}"` : ''}
           ${node.sourceColumn ? `data-column="${node.sourceColumn}"` : ''}>
            <!-- Tooltip with full name -->
            <title>${escapeHtml(node.fullName)}</title>
            <!-- Node background -->
            <rect
                width="${cfg.nodeWidth}"
                height="${cfg.nodeHeight}"
                rx="6"
                ry="6"
                fill="var(--vscode-editor-background, #1e1e1e)"
                stroke="${color}"
                stroke-width="2"
                class="node-rect"
            />
            <!-- Color accent bar -->
            <rect
                x="0"
                y="0"
                width="4"
                height="${cfg.nodeHeight}"
                rx="2"
                ry="2"
                fill="${color}"
            />
            <!-- Node name -->
            <text
                x="${cfg.nodeWidth / 2}"
                y="20"
                text-anchor="middle"
                class="node-name"
                fill="var(--vscode-foreground, #ccc)"
                font-size="12"
                font-weight="600">
                ${escapeHtml(truncateName(node.name, 18))}
            </text>
            <!-- Node type label -->
            <text
                x="${cfg.nodeWidth / 2}"
                y="38"
                text-anchor="middle"
                class="node-type"
                fill="var(--vscode-descriptionForeground, #888)"
                font-size="10">
                ${escapeHtml(typeLabel)}
            </text>
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
 * Get display label for node type
 */
function getTypeLabel(node: LineageNode): string {
    if (node.statementType) {
        return `${node.nodeType} (${node.statementType})`;
    }
    return node.nodeType;
}

/**
 * Truncate name if too long
 */
function truncateName(name: string, maxLength: number): string {
    if (name.length <= maxLength) {return name;}
    return name.substring(0, maxLength - 2) + '..';
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

        .edge {
            transition: stroke 0.2s, stroke-width 0.2s;
        }

        .edge:hover {
            stroke: var(--vscode-focusBorder, #007acc);
            stroke-width: 3;
        }

        .node {
            cursor: pointer;
        }

        .node:hover .node-rect {
            stroke-width: 3;
            filter: drop-shadow(0 2px 8px rgba(0,0,0,0.3));
        }

        .node-source .node-rect:hover {
            stroke: ${NODE_COLORS.SOURCE};
        }

        .node-cte .node-rect:hover {
            stroke: ${NODE_COLORS.CTE};
        }

        .node-target .node-rect:hover {
            stroke: ${NODE_COLORS.TARGET};
        }

        .node-result .node-rect:hover {
            stroke: ${NODE_COLORS.RESULT};
        }

        .node-name {
            font-family: var(--vscode-font-family);
            pointer-events: none;
        }

        .node-type {
            font-family: var(--vscode-font-family);
            pointer-events: none;
        }
    `;
}

/**
 * Generate legend HTML
 */
export function renderLegend(): string {
    return `
        <div class="legend">
            <div class="legend-item">
                <span class="legend-color" style="background: ${NODE_COLORS.SOURCE}"></span>
                <span>Source Table</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: ${NODE_COLORS.CTE}"></span>
                <span>CTE</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: ${NODE_COLORS.TARGET}"></span>
                <span>Target Table</span>
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: ${NODE_COLORS.RESULT}"></span>
                <span>Query Result</span>
            </div>
        </div>
    `;
}
