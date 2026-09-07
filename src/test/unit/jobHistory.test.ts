import * as assert from 'assert';
import {
    describeLiveRequestRow,
    describeQueryInsightsRow,
    formatJobBytes,
    jobEntryDescription,
    jobEntryLabel,
    queryInsightsSql,
    liveRequestsSql,
    relativeAge,
} from '../../services/jobHistoryService';

/** One queryinsights.exec_requests_history row in the SELECT's column order. */
const qiRow = (over: Partial<Record<string, unknown>> = {}): unknown[] => {
    const r: Record<string, unknown> = {
        distributed_statement_id: 'A1B2', database_name: 'Zim_WH_Gold_Dev', submit_time: '2026-09-07T10:00:00.000Z', start_time: '2026-09-07T10:00:00.100Z',
        end_time: '2026-09-07T10:00:02.100Z', statement_type: 'SELECT', total_elapsed_time_ms: 2000, login_name: 'steven@example.com', row_count: 10,
        status: 'Succeeded', session_id: 55, program_name: 'vscode', label: null, result_cache_hit: 0, allocated_cpu_time_ms: 350,
        data_scanned_remote_storage_mb: 0.5, data_scanned_memory_mb: 0.25, data_scanned_disk_mb: 0.25, command: 'SELECT 1', error_code: 0, sql_pool_name: 'default',
        ...over,
    };
    return Object.values(r);
};

suite('jobHistoryService (queryinsights)', () => {

    test('maps a succeeded request', () => {
        const e = describeQueryInsightsRow('gold-dev', qiRow());
        assert.strictEqual(e.jobReference.projectId, 'gold-dev');
        assert.strictEqual(e.jobReference.jobId, 'A1B2');
        assert.strictEqual(e.statementType, 'SELECT');
        assert.strictEqual(e.state, 'DONE');
        assert.strictEqual(e.user, 'steven@example.com');
        assert.strictEqual(e.durationMs, 2000);
        assert.strictEqual(e.bytesProcessed, 1048576);       // 1.0 MB scanned across tiers
        assert.strictEqual(e.cacheHit, false);
        assert.strictEqual(e.hasResults, false);
        assert.ok(e.details.some(([k, v]) => k === 'CPU allocated' && v === '0.35 s'));
    });

    test('failed / canceled / cache-hit states', () => {
        assert.strictEqual(describeQueryInsightsRow('c', qiRow({ status: 'Failed', error_code: 208 })).state, 'FAILED');
        assert.strictEqual(describeQueryInsightsRow('c', qiRow({ status: 'Failed', error_code: 208 })).errorMessage, 'error 208');
        assert.strictEqual(describeQueryInsightsRow('c', qiRow({ status: 'Canceled' })).state, 'CANCELED');
        const hit = describeQueryInsightsRow('c', qiRow({ result_cache_hit: 2 }));
        assert.strictEqual(hit.cacheHit, true);
        assert.ok(jobEntryDescription(hit, Date.parse('2026-09-07T10:01:02Z')).includes('cached'));
    });

    test('label truncates long statements on one line; description carries type, user, bytes, duration, age', () => {
        const e = describeQueryInsightsRow('c', qiRow({ command: 'SELECT   a,\n  b ' + 'x'.repeat(100) }));
        const label = jobEntryLabel(e);
        assert.ok(label.length <= 60 && !label.includes('\n'));
        const d = jobEntryDescription(describeQueryInsightsRow('c', qiRow()), Date.parse('2026-09-07T10:01:02Z'));
        for (const part of ['SELECT', 'steven', '1.0 MB', '2.0s', 'ago']) { assert.ok(d.includes(part), `${part} in ${d}`); }
    });

    test('SQL builders: paging, own-user filter, live requests exclude own session', () => {
        const page2 = queryInsightsSql(true, 50, 50);
        assert.ok(page2.includes('WHERE login_name = USER_NAME()'));
        assert.ok(page2.includes('OFFSET 50 ROWS FETCH NEXT 50 ROWS ONLY'));
        assert.ok(!queryInsightsSql(false, 0, 50).includes('WHERE'));
        assert.ok(liveRequestsSql(false).includes('r.session_id <> @@SPID'));
        assert.ok(liveRequestsSql(true).includes('SUSER_SNAME()'));
    });
});

suite('jobHistoryService (live DMV)', () => {
    test('maps a running request', () => {
        const e = describeLiveRequestRow('azsql', [61, 'running', 'SELECT', '2026-09-07T10:00:00Z', 1500, 'me', 0, 200, 4000, 'SELECT * FROM t']);
        assert.strictEqual(e.jobType, 'live');
        assert.strictEqual(e.state, 'RUNNING');
        assert.strictEqual(e.jobReference.jobId, 'session 61');
        assert.strictEqual(e.query, 'SELECT * FROM t');
        assert.strictEqual(describeLiveRequestRow('a', [1, 'suspended', 'SELECT', null, 0, 'u', 0, 0, 0, '']).state, 'PENDING');
    });
});

suite('jobHistoryService helpers', () => {
    test('relativeAge buckets', () => {
        const now = 1_000_000_000_000;
        assert.strictEqual(relativeAge(now - 30e3, now), '30s ago');
        assert.strictEqual(relativeAge(now - 5 * 60e3, now), '5m ago');
        assert.strictEqual(relativeAge(now - 3 * 3600e3, now), '3h ago');
        assert.strictEqual(relativeAge(now - 2 * 86400e3, now), '2d ago');
    });

    test('formatJobBytes', () => {
        assert.strictEqual(formatJobBytes(0), '0 B');
        assert.strictEqual(formatJobBytes(512), '512 B');
        assert.strictEqual(formatJobBytes(1536), '1.5 KB');
    });
});
