const DSH_ORIGINS = new Set(['http://127.0.0.1:19387', 'dsh-app://app']);
const MESSAGE_NAMESPACE = 'local-task-map/v1';
let trustedParentOrigin = null;

export function isDshFrame() {
  return window.parent !== window && window.location.origin === 'http://127.0.0.1:4173';
}

export function connectDshFrame(onMessage) {
  if (!isDshFrame()) return () => {};
  const receive = (event) => {
    if (event.source !== window.parent || !DSH_ORIGINS.has(event.origin)) return;
    const message = event.data;
    if (message?.namespace !== MESSAGE_NAMESPACE) return;
    if (message.type === 'session' || message.type === 'project' || message.type === 'error' || message.type === 'loading') {
      trustedParentOrigin = event.origin;
      onMessage(message);
    }
  };
  trustedParentOrigin = null;
  window.addEventListener('message', receive);
  // The desktop shell can suppress referrers; this signal contains no session data.
  window.parent.postMessage({ namespace: MESSAGE_NAMESPACE, type: 'ready' }, '*');
  return () => { trustedParentOrigin = null; window.removeEventListener('message', receive); };
}

export function requestDshSession() {
  if (isDshFrame() && trustedParentOrigin) window.parent.postMessage({ namespace: MESSAGE_NAMESPACE, type: 'refresh' }, trustedParentOrigin);
}

export function selectDshProject(key) {
  if (isDshFrame() && trustedParentOrigin) window.parent.postMessage({ namespace: MESSAGE_NAMESPACE, type: 'select-project', key }, trustedParentOrigin);
}

export function requestMoreProjectSessions() {
  if (isDshFrame() && trustedParentOrigin) window.parent.postMessage({ namespace: MESSAGE_NAMESPACE, type: 'load-project-more' }, trustedParentOrigin);
}

export function openDshSession(sessionId) {
  if (isDshFrame() && trustedParentOrigin) window.parent.postMessage({ namespace: MESSAGE_NAMESPACE, type: 'open-session', sessionId }, trustedParentOrigin);
}

export function showDshProject() {
  if (isDshFrame() && trustedParentOrigin) window.parent.postMessage({ namespace: MESSAGE_NAMESPACE, type: 'show-project' }, trustedParentOrigin);
}

export function requestOlderEvents() {
  if (isDshFrame() && trustedParentOrigin) window.parent.postMessage({ namespace: MESSAGE_NAMESPACE, type: 'load-older' }, trustedParentOrigin);
}
