import { serverEnv } from '@core/env'

export const runtime = 'nodejs'

/**
 * Storefront chat widget loader.
 *
 * Everything this script receives is public: a merchant id and an agent id.
 * All catalogue access happens server-side through the merchant-scoped chat
 * endpoint, so the widget cannot read another merchant's data even if a page
 * author edits its attributes.
 */
export async function GET() {
  const appUrl = serverEnv().appUrl

  const js = `(function () {
  'use strict';
  var current = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  var MERCHANT_ID = (current && current.getAttribute('data-merchant-id')) ||
    (window.AGENTIC_COMMERCE && window.AGENTIC_COMMERCE.merchantId) || '';
  var AGENT_ID = (current && current.getAttribute('data-agent-id')) ||
    (window.AGENTIC_COMMERCE && window.AGENTIC_COMMERCE.agentId) || '';
  var BASE = ${JSON.stringify(appUrl)};
  var ACCENT = (current && current.getAttribute('data-accent')) || '#1a1f71';

  if (!MERCHANT_ID) { console.warn('[agentic-commerce] data-merchant-id is required'); return; }
  if (document.getElementById('acw-root')) return;

  var history = [];
  var open = false;
  var busy = false;
  var merchantName = '';

  var root = document.createElement('div');
  root.id = 'acw-root';
  root.setAttribute('data-agent-id', AGENT_ID);

  var style = document.createElement('style');
  style.textContent = [
    '#acw-root{position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '#acw-btn{width:56px;height:56px;border-radius:28px;border:0;cursor:pointer;background:' + ACCENT + ';color:#fff;box-shadow:0 8px 26px rgba(0,0,0,.24);display:flex;align-items:center;justify-content:center}',
    '#acw-btn svg{width:24px;height:24px}',
    '#acw-panel{position:absolute;right:0;bottom:70px;width:370px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);background:#fff;border:1px solid #e3e6ec;border-radius:14px;box-shadow:0 20px 60px rgba(15,23,42,.22);display:none;flex-direction:column;overflow:hidden}',
    '#acw-panel.acw-open{display:flex}',
    '#acw-head{padding:13px 15px;border-bottom:1px solid #eef0f4;display:flex;align-items:center;justify-content:space-between}',
    '#acw-title{font-size:13.5px;font-weight:600;color:#0f172a}',
    '#acw-sub{font-size:11px;color:#64748b;margin-top:2px}',
    '#acw-close{border:0;background:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:2px 4px}',
    '#acw-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#fbfcfe}',
    '.acw-m{font-size:13px;line-height:1.5;padding:9px 12px;border-radius:11px;max-width:86%;white-space:pre-wrap;word-wrap:break-word}',
    '.acw-a{background:#fff;border:1px solid #e6e9ef;color:#111827;align-self:flex-start}',
    '.acw-u{background:' + ACCENT + ';color:#fff;align-self:flex-end}',
    '.acw-p{border:1px solid #e6e9ef;background:#fff;border-radius:10px;padding:9px 11px;font-size:12px;color:#0f172a;display:flex;justify-content:space-between;gap:10px}',
    '.acw-p b{font-weight:600}',
    '#acw-form{display:flex;gap:8px;padding:11px;border-top:1px solid #eef0f4;background:#fff}',
    '#acw-in{flex:1;border:1px solid #dfe3ea;border-radius:9px;padding:9px 11px;font-size:13px;outline:none;font-family:inherit}',
    '#acw-in:focus{border-color:' + ACCENT + '}',
    '#acw-send{border:0;background:' + ACCENT + ';color:#fff;border-radius:9px;padding:0 14px;font-size:13px;font-weight:600;cursor:pointer}',
    '#acw-send:disabled{opacity:.5;cursor:default}',
    '#acw-foot{padding:6px 12px;font-size:10px;color:#94a3b8;background:#fff;border-top:1px solid #f1f3f7;text-align:center}'
  ].join('');

  root.innerHTML =
    '<div id="acw-panel">' +
      '<div id="acw-head"><div><div id="acw-title">Store assistant</div><div id="acw-sub">Answers from this store only</div></div>' +
      '<button id="acw-close" aria-label="Close">&times;</button></div>' +
      '<div id="acw-log"></div>' +
      '<form id="acw-form"><input id="acw-in" autocomplete="off" placeholder="What do you need it for?" /><button id="acw-send" type="submit">Send</button></form>' +
      '<div id="acw-foot">Scoped to this merchant\\u2019s catalogue</div>' +
    '</div>' +
    '<button id="acw-btn" aria-label="Chat with the store assistant">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
    '</button>';

  document.head.appendChild(style);
  document.body.appendChild(root);

  var panel = root.querySelector('#acw-panel');
  var log = root.querySelector('#acw-log');
  var form = root.querySelector('#acw-form');
  var input = root.querySelector('#acw-in');
  var send = root.querySelector('#acw-send');

  function bubble(role, text) {
    var d = document.createElement('div');
    d.className = 'acw-m ' + (role === 'user' ? 'acw-u' : 'acw-a');
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function productCard(p) {
    var d = document.createElement('div');
    d.className = 'acw-p';
    var left = document.createElement('div');
    left.innerHTML = '<b></b><br><span style="color:#64748b"></span>';
    left.querySelector('b').textContent = p.title;
    left.querySelector('span').textContent = p.specs.gpu + ' \\u00b7 ' + p.specs.ramGb + ' GB \\u00b7 ' + p.warrantyYears + 'y warranty';
    var right = document.createElement('div');
    right.style.cssText = 'white-space:nowrap;font-weight:600';
    right.textContent = p.currency + ' ' + Math.round(p.price);
    d.appendChild(left); d.appendChild(right);
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  fetch(BASE + '/api/public/merchant/' + encodeURIComponent(MERCHANT_ID))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg) return;
      merchantName = cfg.name;
      root.querySelector('#acw-title').textContent = cfg.name + ' assistant';
      root.querySelector('#acw-sub').textContent = 'Answers from ' + cfg.name + ' only';
    })
    .catch(function () {});

  root.querySelector('#acw-btn').addEventListener('click', function () {
    open = !open;
    panel.classList.toggle('acw-open', open);
    if (open && !log.childNodes.length) {
      bubble('agent', 'Hi. Tell me what you need the laptop for and your budget, and I will find the closest match in ' + (merchantName || 'this store') + '.');
    }
    if (open) input.focus();
  });

  root.querySelector('#acw-close').addEventListener('click', function () {
    open = false; panel.classList.remove('acw-open');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    bubble('user', text);
    history.push({ role: 'user', text: text });
    busy = true; send.disabled = true;
    var thinking = bubble('agent', 'Checking the catalogue\\u2026');

    fetch(BASE + '/api/storefront/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merchantId: MERCHANT_ID, message: text, history: history.slice(-8) })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        thinking.remove();
        var reply = data.text || 'Sorry, I could not answer that.';
        bubble('agent', reply);
        history.push({ role: 'agent', text: reply });
        (data.products || []).slice(0, 3).forEach(productCard);
      })
      .catch(function () {
        thinking.remove();
        bubble('agent', 'I could not reach the store assistant just now.');
      })
      .finally(function () { busy = false; send.disabled = false; input.focus(); });
  });
})();`

  return new Response(js, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  })
}
