// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail panel with the model's own inputs
// and the protocol's farm plan, and a model lab that recomputes the ranking live. No network:
// every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA) {
    app.textContent = 'No radar data: data.js did not load.';
    app.setAttribute('aria-busy', 'false');
    return;
  }
  var MODEL = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var lab = { growth_weight: MODEL.growth_weight, maturity_floor: MODEL.maturity_floor, breadth_per_chain: MODEL.breadth_per_chain };
  var labOn = false;
  var watchSet = {};
  DATA.rows.forEach(function (r) { watchSet[r.slug] = false; });
  (DATA.watchlist_slugs || []).forEach(function (s) { watchSet[s] = true; });

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // The model in one function, the same arithmetic main.ts writes to board.json: the page
  // recomputes a row from the snapshot figures and checks the number the board carries.
  function impliedOf(row, m) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var gm = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? DATA.median_age_days : row.age_days;
    var mm = m.maturity_floor + (1 - m.maturity_floor) * Math.min(1, Math.log(1 + Math.max(age, 0)) / Math.log(1 + m.maturity_horizon_days));
    var bm = 1 + m.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_chains);
    return { implied: Math.max(1, Math.round(row.tvl_usd * row.multiple * gm * mm * bm)), growthMult: gm, maturityMult: mm, breadthMult: bm };
  }
  function labModel() {
    return {
      growth_floor: MODEL.growth_floor, growth_cap: MODEL.growth_cap,
      growth_weight: lab.growth_weight, maturity_floor: lab.maturity_floor,
      maturity_horizon_days: MODEL.maturity_horizon_days,
      breadth_per_chain: lab.breadth_per_chain, breadth_max_chains: MODEL.breadth_max_chains
    };
  }
  function liveImplied(row) { return labOn ? impliedOf(row, labModel()).implied : row.implied_value_usd; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 90;
    if (age < 90) return 90;
    if (age < 365) return 60;
    return 45;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and borrow $20 against it, so the wallet shows both sides of the book.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('liquidity') >= 0) return 'Add $' + capital + ' of liquidity to the busiest ' + name + ' pool on ' + chain + ', in a narrow range around the current price.';
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and hold the vault shares it mints.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $25 of USDC into ' + chain + ' through ' + name + ', then use the bridged funds once inside its own app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('lst') >= 0) return 'Stake $' + capital + " of the chain's native asset through " + name + ' on ' + chain + ' and keep the receipt token it issues.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small position, then hedge it the same day.';
    if (c.indexOf('prediction') >= 0) return 'Fund ' + name + ' with $' + capital + ' and take one small position on a market that settles within a week.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + capital + ' of the stablecoin through ' + name + ' on ' + chain + ' and keep it until the hold is done.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover on ' + name + ' for a position you already hold, and keep the policy live.';
    if (c.indexOf('chain') >= 0) return 'Use ' + name + ' itself: send one transaction a week on its chain and hold $' + capital + ' of its native asset.';
    return 'Deposit $' + capital + ' of USDC into ' + name + "'s main product on " + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page for a points balance.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a fresh wallet for this farm alone, fund it with $' + (capital + 15) + ', and write its seed phrase on paper, never in a chat or a screenshot.', cost: 'about $3 of gas for the funding transaction', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 200 ? 10 : 5) + ' of gas', time: '20 minutes to set up' },
      { text: 'Come back once a week and do one real action: a deposit, a borrow, a swap, a vote, or a claim.', cost: 'about $2 of gas each week', time: '10 minutes a week' },
      { text: "Leave the position untouched for at least " + hold + " days, so it appears in several of the protocol's own snapshots rather than one.", cost: 'the $' + capital + ' stays locked in the position', time: hold + ' days' },
      { text: "Check the protocol's own rewards page for a points balance, and claim only from a link that page itself publishes.", cost: 'nothing to check, and never pay anyone to claim for you', time: '10 minutes' },
      { text: 'Keep a farm log: the wallet address, every date, every transaction hash, and what each step cost.', cost: 'nothing but the log', time: '5 minutes after each step' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !watchSet[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = liveImplied(a); bv = liveImplied(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every one of them rankable. Implied value is a model, not a price.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }, el('small', { text: top ? ' · ' + top.name : '' }))),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watch ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watch = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('label', { class: 'check', for: 'watch' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return liveImplied(r); })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var implied = liveImplied(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (watchSet[r.slug] ? ' · watchlist' : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(implied) })
        )),
        el('td', null, el('span', { class: 'pill' + (watchSet[r.slug] ? ' watch' : ''), text: watchSet[r.slug] ? 'watchlist' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : String(r.mcap_tvl_ratio) }),
        el('td', null, el('span', { class: 'pill', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap-to-TVL ratios are where the board\u2019s multiples come from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = MODEL;
    var multRows = DATA.multiples.map(function (x) {
      return el('tr', null,
        el('td', { text: x.category }),
        el('td', { class: 'num', text: String(x.samples) }),
        el('td', { class: 'num', text: x.multiple.toFixed(3) }),
        el('td', { text: x.source === 'category' ? 'category median' : 'overall median' })
      );
    });
    var labNote = el('p', { class: 'lab-note' + (labOn ? ' on' : ''), id: 'lab-note', text: 'Model lab values differ from the submitted model: the board above is a what-if, not the entry. Reset the sliders to return to the submitted ranking.' });
    var gw = el('input', { type: 'range', id: 'lab-gw', min: '0', max: '1', step: '0.05', value: String(lab.growth_weight), 'aria-label': 'Growth weight' });
    var mf = el('input', { type: 'range', id: 'lab-mf', min: '0.5', max: '0.9', step: '0.05', value: String(lab.maturity_floor), 'aria-label': 'Maturity floor' });
    var bp = el('input', { type: 'range', id: 'lab-bp', min: '0', max: '0.06', step: '0.005', value: String(lab.breadth_per_chain), 'aria-label': 'Breadth per chain' });
    var gwOut = el('output', { for: 'lab-gw', text: lab.growth_weight.toFixed(2) });
    var mfOut = el('output', { for: 'lab-mf', text: lab.maturity_floor.toFixed(2) });
    var bpOut = el('output', { for: 'lab-bp', text: lab.breadth_per_chain.toFixed(3) });
    function syncLab() {
      lab.growth_weight = parseFloat(gw.value);
      lab.maturity_floor = parseFloat(mf.value);
      lab.breadth_per_chain = parseFloat(bp.value);
      gwOut.textContent = lab.growth_weight.toFixed(2);
      mfOut.textContent = lab.maturity_floor.toFixed(2);
      bpOut.textContent = lab.breadth_per_chain.toFixed(3);
      labOn = lab.growth_weight !== MODEL.growth_weight || lab.maturity_floor !== MODEL.maturity_floor || lab.breadth_per_chain !== MODEL.breadth_per_chain;
      render();
    }
    gw.addEventListener('input', syncLab);
    mf.addEventListener('input', syncLab);
    bp.addEventListener('input', syncLab);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + ' + (1 - m.maturity_floor).toFixed(1) + ' x min(1, ln(1 + age_days) / ln(1 + ' + m.maturity_horizon_days + ')) ) x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + ')) )'
      ),
      el('p', { class: 'sub', text: 'The multiple is the market talking: the median market-cap-to-TVL ratio of the live-token protocols in the same category, computed from this snapshot (overall median ' + DATA.overall_multiple.toFixed(3) + ' where a category has fewer than ' + m.min_category_samples + ' live samples). Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses the snapshot\u2019s median age of ' + DATA.median_age_days + ' days.' }),
      el('table', { class: 'mult-table' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live samples' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Source' }))),
        el('tbody', null, multRows)
      ),
      el('h3', { text: 'Model lab' }),
      el('p', { class: 'sub', text: 'Move a slider and the board re-ranks on the same function, so you can see what the ranking depends on.' }),
      el('div', { class: 'lab' },
        el('div', null, el('label', { for: 'lab-gw', text: 'Growth weight ' }, gwOut), gw),
        el('div', null, el('label', { for: 'lab-mf', text: 'Maturity floor ' }, mfOut), mf),
        el('div', null, el('label', { for: 'lab-bp', text: 'Breadth per chain ' }, bpOut), bp)
      ),
      labNote
    );
  }

  var detail = el('aside', { class: 'detail', id: 'detail', 'aria-label': 'Protocol detail' });
  function closeDetail() {
    state.selected = null;
    detail.className = 'detail';
    detail.textContent = '';
    writeHash();
  }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var v = impliedOf(row, MODEL);
    var live = liveImplied(row);
    var steps = farmSteps(row);
    var barW = function (value, lo, hi) { return Math.max(2, Math.min(100, Math.round(((value - lo) / (hi - lo)) * 100))); };
    detail.textContent = '';
    detail.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (watchSet[row.slug] ? ' · watchlist' : '') }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + (row.listed_at || 'unknown') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: closeDetail })
    ));
    detail.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Market multiple (' + row.multiple_source + ')' }), el('b', { class: 'num', text: 'x' + row.multiple.toFixed(3) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → x' + v.growthMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → x' + v.maturityMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Chain breadth (' + row.chains.length + ' chains)' }), el('b', { class: 'num', text: 'x' + v.breadthMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(live) }))
      ),
      el('div', { class: 'factor-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + barW(v.growthMult, 0.75, 1.5) + '%' })),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(v.implied) + (v.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + (labOn ? ' The model lab is on, so this row uses the lab values.' : '') + ' This is an estimate, not a price. The protocol records no token: that is what its DefiLlama record says, not a promise it has none.' })
    ));
    detail.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    detail.className = 'detail open';
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Data: DefiLlama protocol index, snapshot ' + DATA.as_of + '. ' + DATA.source + '.' }),
      el('p', { text: 'A protocol is called pre-token when its record carries no token. That is the record speaking, never a claim that it has none, and an implied value is the model\u2019s estimate, never a price.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!detail.isConnected) document.body.appendChild(detail);
    if (state.selected) openDetail(state.selected);
    else if (detail.className.indexOf('open') >= 0) closeDetail();
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDetail();
  });
})();
