import * as assert from 'assert';
import { formatEstimate, parsePlanEstimate, parsePlanStatements, prettyXml, renderPlanHtml } from '../../services/planEstimate';

const PLAN = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564" Build="16.0.1000.6">
  <BatchSequence><Batch><Statements>
    <StmtSimple StatementText="SELECT TOP 100 * FROM dbo.T" StatementId="1" StatementCompId="1" StatementType="SELECT" StatementSubTreeCost="0.0032853" StatementEstRows="100" StatementOptmLevel="TRIVIAL">
      <QueryPlan CachedPlanSize="16" CompileTime="1" CompileCPU="1" CompileMemory="88">
        <Warnings><ColumnsWithNoStatistics><ColumnReference Column="a"/></ColumnsWithNoStatistics></Warnings>
        <RelOp NodeId="0" PhysicalOp="Top" LogicalOp="Top" EstimateRows="100" EstimatedTotalSubtreeCost="0.0032853">
          <RelOp NodeId="1" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="100" EstimatedTotalSubtreeCost="0.0032753"/>
        </RelOp>
      </QueryPlan>
    </StmtSimple>
    <StmtSimple StatementText="SELECT COUNT(*) FROM dbo.U" StatementId="2" StatementCompId="2" StatementType="SELECT" StatementSubTreeCost="1.5" StatementEstRows="1">
      <QueryPlan><RelOp NodeId="0" PhysicalOp="Stream Aggregate" LogicalOp="Aggregate" EstimateRows="1" EstimatedTotalSubtreeCost="1.5"/></QueryPlan>
    </StmtSimple>
  </Statements></Batch></BatchSequence>
</ShowPlanXML>`;

suite('planEstimate', () => {
    test('sums cost and rows across statements, collects warnings and top operators', () => {
        const p = parsePlanEstimate(PLAN);
        assert.strictEqual(p.statements, 2);
        assert.ok(Math.abs(p.subtreeCost - 1.5032853) < 1e-6);
        assert.strictEqual(p.estimatedRows, 101);
        assert.deepStrictEqual(p.warnings, ['ColumnsWithNoStatistics', 'ColumnReference']);
        assert.strictEqual(p.topOperators[0], 'Stream Aggregate (1.500)');
    });

    test('formatEstimate is compact and flags warnings', () => {
        const s = formatEstimate(parsePlanEstimate(PLAN));
        assert.ok(s.includes('est. 101 rows'), s);
        assert.ok(s.includes('cost 1.50'), s);
        assert.ok(s.includes('$(warning) 2'), s);
        assert.ok(formatEstimate({ statements: 1, subtreeCost: 0, estimatedRows: 2_500_000, warnings: [], topOperators: [] }).includes('2.5M rows'));
    });

    test('parsePlanStatements builds the operator tree with objects and unescaped text', () => {
        const xml = '<StmtSimple StatementText="SELECT TOP 100&#xa;*" StatementType="SELECT" StatementSubTreeCost="0.05" StatementEstRows="100">'
            + '<QueryPlan><RelOp PhysicalOp="Top" LogicalOp="Top" EstimateRows="100" EstimatedTotalSubtreeCost="0.05">'
            + '<RelOp PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="1000" EstimatedTotalSubtreeCost="0.04">'
            + '<Object Database="[D]" Schema="[s]" Table="[T]" Index="[PK]"></Object></RelOp></RelOp></QueryPlan></StmtSimple>';
        const [s] = parsePlanStatements(xml);
        assert.strictEqual(s.text, 'SELECT TOP 100\n*');
        assert.strictEqual(s.root?.physicalOp, 'Top');
        assert.strictEqual(s.root?.children[0].object, '[D].[s].[T] [PK]');
        assert.strictEqual(s.root?.children[0].estimateRows, 1000);
        const html = renderPlanHtml([s], 'gold-dev');
        assert.ok(html.includes('Clustered Index Scan') && html.includes('[D].[s].[T]') && html.includes('gold-dev'));
        assert.ok(!html.includes('<script'));
    });

    test('prettyXml collapses empty element pairs', () => {
        assert.strictEqual(prettyXml('<A><B x="1"></B></A>'), '<A>\n  <B x="1"/>\n</A>');
    });

    test('prettyXml indents one-line XML and keeps text content inline', () => {
        const out = prettyXml('<?xml version="1.0"?><A x="1"><B/><C>text</C><D><E/></D></A>');
        assert.strictEqual(out, [
            '<?xml version="1.0"?>', '<A x="1">', '  <B/>', '  <C>text</C>', '  <D>', '    <E/>', '  </D>', '</A>',
        ].join('\n'));
    });

    test('empty / non-plan input degrades to zeros', () => {
        const p = parsePlanEstimate('<nothing/>');
        assert.deepStrictEqual([p.statements, p.subtreeCost, p.estimatedRows, p.warnings.length], [0, 0, 0, 0]);
    });
});
