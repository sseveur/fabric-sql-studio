import { QueryLineageInfo } from '../services/lineageGraph';
import { getGraphStyles, renderLegend } from './svgRenderer';

/** A query with lineage and its already-rendered graph SVG. */
export interface LineageSection {
    queryInfo: QueryLineageInfo;
    svg: string;
}

/** A value as a JS string literal that is also safe inside an inline <script>. */
function jsString(value: string): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** lineage_query[N][_linesA-B]_YYYYMMDD_HHMMSS.<format>, local time. */
export function exportFilename(
    format: 'png' | 'pdf',
    queryIndex?: number,
    lineRange?: string,
    date: Date = new Date()
): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp =
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

    if (queryIndex !== undefined) {
        const lineRangePart = lineRange ? `_lines${lineRange}` : '';
        return `lineage_query${queryIndex + 1}${lineRangePart}_${timestamp}.${format}`;
    }

    return `lineage_query_${timestamp}.${format}`;
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Full webview page for the lineage panel: one collapsible section per query with lineage.
 * `exportTheme` is the fabricSql.lineageExportTheme value the PNG/PDF export starts with.
 */
export function renderLineageHtml(sections: LineageSection[], exportTheme: string): string {
    const styles = getGraphStyles();
    const legend = renderLegend();

    const querySections = sections
        .map((section, displayIndex) => renderQuerySection(section, displayIndex))
        .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Lineage</title>
    <style>
        @font-face {
            font-family: 'codicon';
            src: url('https://microsoft.github.io/vscode-codicons/dist/codicon.ttf') format('truetype');
        }
        .codicon {
            font-family: 'codicon';
            font-size: 16px;
            line-height: 1;
            display: inline-block;
        }
        .codicon-chevron-down:before { content: "\\eab4"; }
        .codicon-chevron-right:before { content: "\\eab6"; }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            position: sticky;
            top: 0;
            background-color: var(--vscode-editor-background);
            z-index: 100;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .header h2 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }

        .query-count {
            font-size: 12px;
            padding: 4px 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 10px;
        }

        .queries-container {
            display: flex;
            flex-direction: column;
            gap: 24px;
            overflow-y: auto;
            flex: 1;
            padding-bottom: 40px;
        }

        .query-section {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            max-height: 500px;
        }

        .query-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
        }

        .query-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .query-title {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .query-number {
            font-size: 11px;
            font-weight: 600;
            padding: 2px 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 4px;
        }

        .query-lines {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .query-preview-text {
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            max-width: 400px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .query-stats {
            display: flex;
            gap: 12px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .query-body {
            padding: 16px;
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }

        .query-section.collapsed .query-body {
            display: none;
        }

        .query-section.collapsed .query-header {
            border-bottom: none;
        }

        .collapse-toggle {
            width: 20px;
            height: 20px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            margin-right: 4px;
            border-radius: 3px;
        }

        .collapse-toggle:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }

        .collapse-toggle .codicon {
            font-size: 14px;
        }

        .graph-container {
            overflow: auto;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            background-color: var(--vscode-editor-background);
            min-height: 300px;
            flex: 1;
        }

        .graph-wrapper {
            transform-origin: top left;
        }

        .section-controls {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 8px;
        }

        .zoom-controls {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .zoom-btn {
            width: 24px;
            height: 24px;
            border: 1px solid var(--vscode-button-secondaryBackground);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .zoom-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .zoom-level {
            min-width: 40px;
            text-align: center;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }

        .export-controls {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-left: 12px;
        }

        .export-btn {
            height: 24px;
            padding: 0 10px;
            border: 1px solid var(--vscode-button-secondaryBackground);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
            white-space: nowrap;
        }

        .export-btn:hover:not(:disabled) {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .export-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .query-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .export-btn-small {
            height: 22px;
            padding: 0 8px;
            border: 1px solid var(--vscode-button-secondaryBackground);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
            text-transform: uppercase;
            font-weight: 600;
            white-space: nowrap;
        }

        .export-btn-small:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        ${styles}

        .legend {
            display: flex;
            gap: 16px;
            font-size: 11px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .legend-color {
            width: 12px;
            height: 12px;
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <h2>Data Lineage</h2>
            <span class="query-count">${sections.length} ${sections.length === 1 ? 'query' : 'queries'} with lineage</span>
            <div class="export-controls">
                <button class="export-btn" id="export-all-png" title="Download all as separate PNG files">↓ All PNG</button>
                <button class="export-btn" id="export-all-pdf" title="Download all as multi-page PDF">↓ All PDF</button>
            </div>
        </div>
        ${legend}
    </div>

    <div class="queries-container">
        ${querySections}
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();

            // Export theme from extension settings
            var exportTheme = ${jsString(exportTheme)};

            // Listen for theme changes from extension host
            window.addEventListener('message', function(event) {
                if (event.data && event.data.type === 'themeChanged') {
                    exportTheme = event.data.theme;
                }
            });

            // Per-section zoom state
            const zoomStates = {};

            // Initialize zoom for each section
            document.querySelectorAll('.query-section').forEach((section, index) => {
                zoomStates[index] = 1;

                const wrapper = section.querySelector('.graph-wrapper');
                const levelDisplay = section.querySelector('.zoom-level');
                const container = section.querySelector('.graph-container');

                function updateZoom() {
                    if (wrapper) {
                        wrapper.style.transform = 'scale(' + zoomStates[index] + ')';
                        levelDisplay.textContent = Math.round(zoomStates[index] * 100) + '%';
                    }
                }

                section.querySelector('.zoom-in')?.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (zoomStates[index] < 2) {
                        zoomStates[index] = Math.min(2, zoomStates[index] + 0.25);
                        updateZoom();
                    }
                });

                section.querySelector('.zoom-out')?.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (zoomStates[index] > 0.25) {
                        zoomStates[index] = Math.max(0.25, zoomStates[index] - 0.25);
                        updateZoom();
                    }
                });

                section.querySelector('.zoom-reset')?.addEventListener('click', function(e) {
                    e.stopPropagation();
                    zoomStates[index] = 1;
                    updateZoom();
                });

                // Mouse wheel zoom
                if (container) {
                    container.addEventListener('wheel', function(e) {
                        if (e.ctrlKey) {
                            e.preventDefault();
                            if (e.deltaY < 0 && zoomStates[index] < 2) {
                                zoomStates[index] = Math.min(2, zoomStates[index] + 0.25);
                            } else if (e.deltaY > 0 && zoomStates[index] > 0.25) {
                                zoomStates[index] = Math.max(0.25, zoomStates[index] - 0.25);
                            }
                            updateZoom();
                        }
                    }, { passive: false });
                }
            });

            // Click handler for collapse toggle buttons
            document.querySelectorAll('.collapse-toggle').forEach(function(toggle) {
                toggle.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const section = this.closest('.query-section');
                    if (section) {
                        section.classList.toggle('collapsed');
                        const icon = this.querySelector('.codicon');
                        if (icon) {
                            if (section.classList.contains('collapsed')) {
                                icon.classList.remove('codicon-chevron-down');
                                icon.classList.add('codicon-chevron-right');
                            } else {
                                icon.classList.remove('codicon-chevron-right');
                                icon.classList.add('codicon-chevron-down');
                            }
                        }
                    }
                });
            });

            // Click handler for nodes - navigate to source position
            document.querySelectorAll('.node').forEach(function(node) {
                node.style.cursor = 'pointer';
                node.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const line = parseInt(this.getAttribute('data-line')) || null;
                    const column = parseInt(this.getAttribute('data-column')) || null;
                    const fullName = this.getAttribute('data-fullname') || '';

                    vscode.postMessage({
                        type: 'navigate',
                        line: line,
                        column: column,
                        fullName: fullName
                    });
                });
            });

            // Click handler for query headers - navigate to query start
            document.querySelectorAll('.query-header').forEach(function(header) {
                header.addEventListener('click', function(e) {
                    // Don't trigger if clicking on zoom controls, collapse toggle, or export buttons
                    if (e.target.closest('.zoom-controls')) return;
                    if (e.target.closest('.collapse-toggle')) return;
                    if (e.target.closest('.export-btn-small')) return;
                    if (e.target.closest('.export-btn')) return;

                    const line = parseInt(this.getAttribute('data-start-line')) || 1;
                    vscode.postMessage({
                        type: 'scrollToQuery',
                        line: line
                    });
                });
            });

            // Color maps for export themes
            var darkColorMap = {
                '--vscode-editor-background': '#1e1e1e',
                '--vscode-foreground': '#cccccc',
                '--vscode-descriptionForeground': '#888888',
                '--vscode-panel-border': '#3e3e3e',
                '--vscode-sideBar-background': '#252526',
                '--vscode-list-hoverBackground': '#2a2d2e'
            };
            var lightColorMap = {
                '--vscode-editor-background': '#ffffff',
                '--vscode-foreground': '#000000',
                '--vscode-descriptionForeground': '#666666',
                '--vscode-panel-border': '#d0d0d0',
                '--vscode-sideBar-background': '#f3f3f3',
                '--vscode-list-hoverBackground': '#e8e8e8'
            };

            function resolveThemeColor(varName, fallback) {
                var colorMap = exportTheme === 'light' ? lightColorMap : darkColorMap;
                var key = '--' + varName;
                if (colorMap[key]) return colorMap[key];
                var value = getComputedStyle(document.documentElement).getPropertyValue(key).trim();
                return value || (fallback ? fallback.trim() : '');
            }

            // SVG to PNG conversion using Canvas API
            function svgToPngBase64(svgElement, scale) {
                scale = scale || 2;
                return new Promise(function(resolve, reject) {
                    var serializer = new XMLSerializer();
                    var svgStr = serializer.serializeToString(svgElement);

                    svgStr = svgStr.replace(/var\(--([^,)]+)(?:,\s*([^)]+))?\)/g, function(match, varName, fallback) {
                        var resolved = resolveThemeColor(varName.trim(), fallback);
                        return resolved || match;
                    });

                    var bgColor = exportTheme === 'light' ? '#ffffff' : '#1e1e1e';

                    var blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
                    var url = URL.createObjectURL(blob);
                    var img = new Image();

                    img.onload = function() {
                        var canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth * scale;
                        canvas.height = img.naturalHeight * scale;
                        var ctx = canvas.getContext('2d');
                        ctx.fillStyle = bgColor;
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.scale(scale, scale);
                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(url);
                        resolve({
                            dataUrl: canvas.toDataURL('image/png'),
                            width: img.naturalWidth,
                            height: img.naturalHeight
                        });
                    };

                    img.onerror = function() {
                        URL.revokeObjectURL(url);
                        reject(new Error('Failed to render SVG to image'));
                    };

                    img.src = url;
                });
            }

            // Export all buttons
            function handleExportAll(format) {
                var sections = document.querySelectorAll('.query-section');
                var promises = [];
                sections.forEach(function(section) {
                    var svg = section.querySelector('.graph-wrapper svg');
                    var queryIndex = parseInt(section.getAttribute('data-query-index'));
                    if (svg && !isNaN(queryIndex)) {
                        promises.push(svgToPngBase64(svg).then(function(result) {
                            return { pngBase64: result.dataUrl, width: result.width, height: result.height, queryIndex: queryIndex };
                        }));
                    }
                });
                Promise.all(promises).then(function(items) {
                    if (items.length > 0) {
                        vscode.postMessage({
                            type: 'exportAllPngData',
                            format: format,
                            items: items
                        });
                    }
                }).catch(function(err) {
                    vscode.postMessage({ type: 'exportError', error: err.message });
                });
            }

            document.getElementById('export-all-png')?.addEventListener('click', function() {
                handleExportAll('png');
            });

            document.getElementById('export-all-pdf')?.addEventListener('click', function() {
                handleExportAll('pdf');
            });

            // Per-query export buttons
            document.querySelectorAll('.export-btn-small').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var queryIndex = parseInt(this.getAttribute('data-query-index'));
                    var format = this.getAttribute('data-format');
                    var section = this.closest('.query-section');
                    var svg = section ? section.querySelector('.graph-wrapper svg') : null;
                    if (!svg) return;
                    svgToPngBase64(svg).then(function(result) {
                        vscode.postMessage({
                            type: 'exportPngData',
                            format: format,
                            pngBase64: result.dataUrl,
                            width: result.width,
                            height: result.height,
                            queryIndex: queryIndex
                        });
                    }).catch(function(err) {
                        vscode.postMessage({ type: 'exportError', error: err.message });
                    });
                });
            });
        })();
    </script>
</body>
</html>`;
}

/**
 * Render a single query section with its lineage graph
 */
export function renderQuerySection(section: LineageSection, displayIndex: number): string {
    const { graph, startLine, endLine, sqlText } = section.queryInfo;
    const svgContent = section.svg;

    // Count nodes by type
    const sourceCount = graph.nodes.filter(n => n.nodeType === 'SOURCE').length;
    const cteCount = graph.nodes.filter(n => n.nodeType === 'CTE').length;
    const targetCount = graph.nodes.filter(n => n.nodeType === 'TARGET').length;

    // Create query preview (first 80 chars)
    const preview = sqlText.replace(/\s+/g, ' ').trim().substring(0, 80);
    const previewDisplay = preview + (sqlText.length > 80 ? '...' : '');

    return `
        <div class="query-section" data-query-index="${displayIndex}">
            <div class="query-header" data-start-line="${startLine}">
                <div class="query-title">
                    <button class="collapse-toggle" title="Collapse/Expand">
                        <span class="codicon codicon-chevron-down"></span>
                    </button>
                    <span class="query-number">Query ${displayIndex + 1}</span>
                    <span class="query-lines">Lines ${startLine}-${endLine}</span>
                    <span class="query-preview-text">${escapeHtml(previewDisplay)}</span>
                </div>
                <div class="query-actions">
                    <button class="export-btn-small" data-query-index="${displayIndex}" data-format="png" title="Download PNG">PNG</button>
                    <button class="export-btn-small" data-query-index="${displayIndex}" data-format="pdf" title="Download PDF">PDF</button>
                    <div class="query-stats">
                        <span>${sourceCount} source${sourceCount !== 1 ? 's' : ''}</span>
                        ${cteCount > 0 ? `<span>${cteCount} CTE${cteCount !== 1 ? 's' : ''}</span>` : ''}
                        ${targetCount > 0 ? `<span>${targetCount} target${targetCount !== 1 ? 's' : ''}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="query-body">
                <div class="section-controls">
                    <div class="zoom-controls">
                        <button class="zoom-btn zoom-out" title="Zoom out">-</button>
                        <span class="zoom-level">100%</span>
                        <button class="zoom-btn zoom-in" title="Zoom in">+</button>
                        <button class="zoom-btn zoom-reset" title="Reset zoom">R</button>
                    </div>
                </div>
                <div class="graph-container">
                    <div class="graph-wrapper">${svgContent}</div>
                </div>
            </div>
        </div>
    `;
}
