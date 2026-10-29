/* Runs only in the HTML sandbox, after the fixed renderer module. */
/* global createUIRenderer */
const nonce =
  document.currentScript?.dataset.nonce ??
  document.querySelector('script[data-nonce]').dataset.nonce;
let port;
const renderer = createUIRenderer(document, (message) => port?.postMessage(message));
window.addEventListener('message', function welcome(event) {
  if (
    event.source !== parent ||
    event.data?.nonce !== nonce ||
    event.data.protocol !== 'scwc-declarative-ui' ||
    event.data.version !== 1 ||
    !event.ports[0] ||
    port
  )
    return;
  port = event.ports[0];
  port.onmessage = renderer.receive;
  port.start();
  window.removeEventListener('message', welcome);
});
parent.postMessage(
  { protocol: 'scwc-declarative-ui', version: 1, type: 'scwc-ui-ready', nonce },
  '*',
);
