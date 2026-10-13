import { normalizeDshSession } from './normalizeSession.js';
import { sampleDshSession } from './dshSampleSession.js';

const normalized = normalizeDshSession(sampleDshSession);

export const sessionInfo = normalized.sessionInfo;
export const initialNodes = normalized.nodes;
export const initialEdges = normalized.edges;
export const sessionDiagnostics = normalized.diagnostics;
export { sampleDshSession };
