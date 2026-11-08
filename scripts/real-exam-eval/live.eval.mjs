import { it, expect } from 'vitest';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createEmptyDocument } from '@draw/dsl';
import { contentFingerprint } from '@draw/scene-graph';
import { createAgentRuntime } from '../../apps/web/src/agent/agentRuntime';
import { createModelPlanner } from '../../apps/web/src/agent/modelPlanner';
import { readProblemImages, listImageReaders } from '../../apps/web/src/services/problemImageReader';
import { imagePrompt, splitImagePrompt } from '../../apps/web/src/services/problemImagePrompt';
import { createRequire } from 'node:module';
const { score } = createRequire(import.meta.url)('./score.cjs');
it('explicitly authorized real-exam baseline, no fixtures or mocked provider responses', async () => {
    if (process.env.MATHCANVAS_REAL_EXAM_LIVE !== '1')
        throw new Error('Requires explicit MATHCANVAS_REAL_EXAM_LIVE=1');
    const out = path.resolve(process.env.MATHCANVAS_REAL_EXAM_OUT ?? 'eval-results/real-exams-20261105/baseline');
    if (fs.existsSync(path.join(out, 'summary.json')))
        throw new Error('Refusing to overwrite a completed run');
    fs.mkdirSync(out, { recursive: true });
    const all = JSON.parse(fs.readFileSync('test-fixtures/real-exams-20261105/cases.json', 'utf8'));
    const cases = process.env.MATHCANVAS_REAL_EXAM_IDS ? all.filter((q) => process.env.MATHCANVAS_REAL_EXAM_IDS.split(',').includes(q.id)) : all;
    const browser = await chromium.connectOverCDP(process.env.MATHCANVAS_REAL_EXAM_CDP ?? 'http://127.0.0.1:9227');
    const page = browser.contexts()[0].pages().find(p => p.url().includes('tauri.localhost'));
    expect(page).toBeTruthy();
    const allowed = new Set(['list_provider_profiles', 'active_provider_profile', 'provider_health', 'provider_run', 'provider_cancel']);
    const max = Number(process.env.MATHCANVAS_REAL_EXAM_MAX_REQUESTS ?? 450);
    let totalRequests = 0, current = null;
    const native = async (command, args = {}) => page.evaluate(async ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
    const invoke = async (command, args = {}) => {
        if (!allowed.has(command))
            throw new Error(`Evaluation blocked non-allowlisted native command: ${command}`);
        if (command !== 'provider_run')
            return native(command, args);
        if (totalRequests >= max)
            throw new Error('GLOBAL_REQUEST_LIMIT');
        totalRequests++;
        const record = { number: totalRequests, runId: args.runId, startedAt: new Date().toISOString(), request: { ...args, messages: args.messages.map((m) => ({ ...m, ...(m.images ? { images: m.images.map((s) => `[base64 image ${s.length} chars; see corpus PNG]`) } : {}) })) } };
        current.requests.push(record);
        const start = Date.now();
        let timer;
        try {
            const response = await Promise.race([native(command, args), new Promise((_, reject) => { timer = setTimeout(() => { void native('provider_cancel', { runId: args.runId }); reject(new Error('REQUEST_TIMEOUT_90000MS')); }, 90000); })]);
            record.response = response;
            return response;
        }
        catch (error) {
            record.error = String(error);
            throw error;
        }
        finally {
            clearTimeout(timer);
            record.elapsedMs = Date.now() - start;
            fs.writeFileSync(path.join(out, current.id + '-requests.json'), JSON.stringify(current.requests, null, 2));
        }
    };
    globalThis.__TAURI_INTERNALS__ = { invoke };
    const readers = await listImageReaders();
    const profile = readers.profiles.find(p => p.id === readers.activeId);
    expect(profile, 'active provider must pass the actual production vision gate').toBeTruthy();
    const results = [];
    try {
        for (const q of cases) {
            const started = Date.now();
            current = { id: q.id, requests: [] };
            const requests = current.requests;
            const runId = `real-exam-${q.id}-${Date.now()}`;
            const result = { id: q.id, year: q.year, paper: q.paper, questionNumber: q.questionNumber, workspace: q.workspace, visionRequired: !!q.sheet, expected: q.expected, startedAt: new Date().toISOString(), terminal: 'not_started', events: [], stages: [], diagnostics: [], reading: null, error: null, answer: null, draft: null, liveWrites: 0 };
            let runtime = null;
            const controller = new AbortController();
            const timer = setTimeout(() => { result.timedOut = true; controller.abort(); runtime?.coordinator.cancel('user'); }, 180000);
            try {
                const instructions = '请解答此题，给出必要推导，并以“最终答案：X”明确最终选项。如需图形辅助，请生成可核验的图形草稿。';
                let prompt = q.question + '\n' + instructions, imageNotes = '';
                if (q.sheet) {
                    result.reading = await readProblemImages(profile, [{ name: q.id + '.png', png: fs.readFileSync(q.sheet).toString('base64') }], runId + '-vision', controller.signal);
                    const combined = imagePrompt(result.reading.problem, instructions, [...result.reading.diagram.map((d) => d.text), ...result.reading.uncertainties.map((d) => '识图不确定：' + d.text)]);
                    ({ prompt, imageNotes } = splitImagePrompt(combined));
                }
                controller.signal.throwIfAborted();
                result.modelPrompt = prompt;
                result.imageNotes = imageNotes;
                const document = createEmptyDocument(q.workspace);
                const handle = { projectId: 'exam-isolated', documentId: document.metadata.id, workspace: document.workspace, epoch: 'exam:' + q.id, generation: document.revision, contentHash: contentFingerprint(document) };
                const planner = createModelPlanner({ imageNotes, onDiagnostic: line => result.diagnostics.push(line) });
                runtime = createAgentRuntime({ readDocument: () => document, writeDocument: () => { result.liveWrites++; throw new Error('Automatic write prohibited'); }, readSceneDocuments: () => [{ handle, document }], planner, projectId: 'exam-isolated', runId, onStageOutcome: outcome => result.stages.push(outcome), exportPreflight: { preflight: () => { throw new Error('Export not under test'); } } });
                const run = { runId, conversationId: runId, promptMessageId: runId + '-prompt', target: handle, sources: [], textProfileId: profile.id, capabilityRevision: '2026-11-05.real-exam', policyRevision: 'baseline' };
                for await (const event of runtime.coordinator.start({ run, userMessage: prompt })) {
                    result.events.push(event);
                    result.terminal = event.phase;
                }
                result.answer = runtime.answer() ?? null;
                result.questions = runtime.questions() ?? null;
                const draftId = runtime.draftId();
                result.draft = draftId ? runtime.drafts.getPreview(draftId)?.candidate ?? null : null;
            }
            catch (error) {
                result.error = String(error);
                if (result.terminal === 'not_started')
                    result.terminal = q.sheet && !result.reading ? 'vision_failed' : 'infrastructure_failed';
            }
            finally {
                clearTimeout(timer);
            }
            result.elapsedMs = Date.now() - started;
            result.requests = requests.length;
            result.deliverySuccess = !result.error && !result.timedOut && (result.terminal === 'completed' || (result.terminal === 'awaiting_confirmation' && result.draft !== null));
            result.score = score(result.answer, q.expected);
            result.endToEndCorrect = result.deliverySuccess && result.score.correct;
            fs.writeFileSync(path.join(out, q.id + '.json'), JSON.stringify(result, null, 2));
            results.push(result);
            fs.writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ completed: results.length, total: cases.length, totalRequests, results: results.map(({ id, terminal, error, score, elapsedMs, deliverySuccess, endToEndCorrect }) => ({ id, terminal, error, score, elapsedMs, deliverySuccess, endToEndCorrect })) }, null, 2));
            console.log(`${results.length}/${cases.length} ${q.id} ${result.terminal} delivery=${result.deliverySuccess} choice=${result.score.choice} expected=${q.expected} correct=${result.endToEndCorrect} ${result.elapsedMs}ms`);
            expect(result.liveWrites).toBe(0);
        }
        const n = results.length, delivered = results.filter(x => x.deliverySuccess).length, answered = results.filter(x => x.score.answered).length, correct = results.filter(x => x.endToEndCorrect).length;
        const summary = { createdAt: new Date().toISOString(), revision: '6fe61d51a4d3a666ec41a61fdb6a2363f7ea4044', model: profile.modelId, profileRevision: profile.revision, total: n, delivered, answered, correct, deliveryRate: delivered / n, endToEndOptionAccuracy: correct / n, conditionalOptionAccuracy: answered ? correct / answered : null, visionRequired: results.filter(x => x.visionRequired).length, visionParsed: results.filter(x => x.visionRequired && x.reading).length, totalRequests, requestCap: max, capabilityProbeRequestsAdditional: 4, costKnown: false, costUsd: null, results: results.map(({ id, terminal, error, score, elapsedMs, deliverySuccess, endToEndCorrect, visionRequired, requests }) => ({ id, terminal, error, score, elapsedMs, deliverySuccess, endToEndCorrect, visionRequired, requests })) };
        fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
        console.log('SUMMARY', JSON.stringify({ ...summary, results: undefined }));
    }
    finally {
        delete globalThis.__TAURI_INTERNALS__;
        await browser.close();
    }
}, 14400000);
