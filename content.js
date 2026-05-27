const HIDDEN_CLASS = 'sb-hidden-result';
const STYLE_ID = 'sb-hidden-style';

const SEARCH_ENGINES = [
  {
    id: 'google',
    hostPatterns: [/^(www\.)?google\./i],
    resultSelectors: [
      '#search .MjjYud',
      '#search .g',
      '#rso > div',
      'div[data-hveid]',
    ],
    closestSelectors: [
      '.MjjYud',
      '.g',
      'div[data-hveid]',
      'div[jscontroller][data-hveid]',
    ],
  },
  {
    id: 'baidu',
    hostPatterns: [/^(www|m)\.baidu\.com$/i, /^baidu\.com$/i],
    resultSelectors: [
      '#content_left .result',
      '#content_left .result-op',
      '#content_left .c-container',
      '#content_left > div',
    ],
    closestSelectors: ['.result', '.result-op', '.c-container', '#content_left > div'],
  },
  {
    id: 'bing',
    hostPatterns: [/^(www|cn)\.bing\.com$/i, /^bing\.com$/i],
    resultSelectors: [
      '#b_results > li',
      '#b_results .b_algo',
      '#b_results .b_ans',
      '#b_topw .b_algo',
      '#b_topw .b_ans',
      '#b_topw li',
      '#b_content .b_algo',
      '#b_content .b_ans',
    ],
    closestSelectors: [
      'li.b_algo',
      'li.b_ans',
      '.b_algo',
      '.b_ans',
      'li[data-bm]',
      '#b_results > li',
      '#b_topw li',
    ],
  },
  {
    id: 'yahoo',
    hostPatterns: [/(^|\.)search\.yahoo\.com$/i],
    resultSelectors: ['#web ol > li', '.searchCenterMiddle li', 'div.dd.algo'],
    closestSelectors: ['li', '.algo', 'div.dd.algo'],
  },
  {
    id: 'sogou',
    hostPatterns: [/^(www|wap)\.sogou\.com$/i, /^sogou\.com$/i],
    resultSelectors: ['.results .vrwrap', '.results .rb', '#main .vrwrap', '#main .rb'],
    closestSelectors: ['.vrwrap', '.rb'],
  },
  {
    id: 'so',
    hostPatterns: [/^(www|m)\.so\.com$/i, /^so\.com$/i],
    resultSelectors: ['#search-result li', '#searchResult li', 'li.res-list', 'li.result'],
    closestSelectors: ['#search-result li', '#searchResult li', 'li.res-list', 'li.result'],
  },
];

let scheduledTimer = null;
let mutationObserver = null;
let latestStats = {
  engine: null,
  keywords: 0,
  results: 0,
  blocked: 0,
  supported: false,
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toCompact(value) {
  return normalizeText(value).replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, '');
}

function ensureHiddenStyle() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.${HIDDEN_CLASS}{display:none !important;}`;
  document.documentElement.appendChild(style);
}

function getSiteConfig() {
  const { hostname } = window.location;
  return SEARCH_ENGINES.find((config) =>
    config.hostPatterns.some((pattern) => pattern.test(hostname))
  );
}

function getElementDepth(element) {
  let depth = 0;
  let current = element;

  while (current.parentElement) {
    depth += 1;
    current = current.parentElement;
  }

  return depth;
}

function isResultCandidate(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const text = normalizeText(element.textContent);
  if (!text) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.height >= 24 || rect.width >= 80 || text.length >= 12;
}

function dedupeResults(elements) {
  const ordered = [...new Set(elements)].sort(
    (left, right) => getElementDepth(left) - getElementDepth(right)
  );
  const results = [];

  ordered.forEach((element) => {
    if (!isResultCandidate(element)) {
      return;
    }

    if (results.some((existing) => existing === element || existing.contains(element))) {
      return;
    }

    results.push(element);
  });

  return results;
}

function collectBySelectors(resultSelectors, closestSelectors) {
  const results = new Set();
  const closestQuery = closestSelectors.join(', ');

  resultSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      const container = closestQuery ? element.closest(closestQuery) || element : element;
      if (container instanceof HTMLElement) {
        results.add(container);
      }
    });
  });

  return dedupeResults(results);
}

function genericScan(config) {
  const results = new Set();
  const closestQuery = config.closestSelectors.join(', ');
  const links = document.querySelectorAll('a[href^="http"]');

  links.forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (href.includes(window.location.hostname)) {
      return;
    }

    const matched = closestQuery ? link.closest(closestQuery) : null;
    if (matched instanceof HTMLElement) {
      results.add(matched);
      return;
    }

    let parent = link.parentElement;
    let depth = 0;

    while (parent && depth < 6) {
      const tagName = parent.tagName.toLowerCase();
      const text = normalizeText(parent.textContent);

      if (
        ['article', 'div', 'li'].includes(tagName) &&
        text.length >= 12 &&
        parent.querySelector('h2, h3, strong')
      ) {
        results.add(parent);
        break;
      }

      parent = parent.parentElement;
      depth += 1;
    }
  });

  return dedupeResults(results);
}

function findResults(config) {
  const directMatches = collectBySelectors(config.resultSelectors, config.closestSelectors);
  const genericMatches = genericScan(config);
  return dedupeResults([...directMatches, ...genericMatches]);
}

async function getKeywords() {
  const data = await chrome.storage.sync.get({ keywords: [] });
  const keywords = Array.isArray(data.keywords) ? data.keywords : [];

  return keywords
    .map((keyword) => ({
      raw: String(keyword || ''),
      normalized: normalizeText(keyword),
      compact: toCompact(keyword),
    }))
    .filter((item) => item.normalized);
}

function matchesKeyword(element, keywords) {
  const pieces = [element.textContent || ''];

  element.querySelectorAll('a[href], cite').forEach((node) => {
    if (node.textContent) {
      pieces.push(node.textContent);
    }

    if (node instanceof HTMLAnchorElement && node.href) {
      pieces.push(node.href);
    }
  });

  const normalized = normalizeText(pieces.join(' '));
  const compact = toCompact(normalized);

  return keywords.some(
    (keyword) =>
      normalized.includes(keyword.normalized) ||
      (keyword.compact && compact.includes(keyword.compact))
  );
}

function setBlockedState(element, shouldBlock) {
  if (shouldBlock) {
    element.classList.add(HIDDEN_CLASS);
    element.style.setProperty('display', 'none', 'important');
    element.dataset.sbBlocked = '1';
    return;
  }

  element.classList.remove(HIDDEN_CLASS);
  element.style.removeProperty('display');
  delete element.dataset.sbBlocked;
}

function restoreBlockedResults() {
  document.querySelectorAll(`.${HIDDEN_CLASS}, [data-sb-blocked="1"]`).forEach((element) => {
    if (element instanceof HTMLElement) {
      setBlockedState(element, false);
    }
  });
}

async function blockResults() {
  const config = getSiteConfig();
  if (!config) {
    latestStats = {
      engine: null,
      keywords: 0,
      results: 0,
      blocked: 0,
      supported: false,
    };
    return;
  }
  ensureHiddenStyle();

  const keywords = await getKeywords();
  if (keywords.length === 0) {
    restoreBlockedResults();
    latestStats = {
      engine: config.id,
      keywords: 0,
      results: 0,
      blocked: 0,
      supported: true,
    };
    return;
  }

  const results = findResults(config);
  if (results.length === 0) {
    latestStats = {
      engine: config.id,
      keywords: keywords.length,
      results: 0,
      blocked: 0,
      supported: true,
    };
    console.debug('[Search Blocker] no result candidates found for', config.id);
    return;
  }

  let blockedCount = 0;

  results.forEach((result) => {
    const shouldBlock = matchesKeyword(result, keywords);
    setBlockedState(result, shouldBlock);

    if (shouldBlock) {
      blockedCount += 1;
    }
  });

  console.debug(
    `[Search Blocker] ${config.id}: hidden ${blockedCount}/${results.length} results`
  );
  latestStats = {
    engine: config.id,
    keywords: keywords.length,
    results: results.length,
    blocked: blockedCount,
    supported: true,
  };
}

function scheduleBlockResults(delay = 0) {
  if (scheduledTimer) {
    window.clearTimeout(scheduledTimer);
  }

  scheduledTimer = window.setTimeout(() => {
    scheduledTimer = null;
    blockResults().catch((error) => {
      console.error('[Search Blocker] failed to block results', error);
    });
  }, delay);
}

function initObserver() {
  if (mutationObserver || !document.body) {
    return;
  }

  mutationObserver = new MutationObserver(() => {
    scheduleBlockResults(120);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function init() {
  scheduleBlockResults(0);
  [200, 800, 1800].forEach((delay) => {
    window.setTimeout(() => {
      scheduleBlockResults(0);
    }, delay);
  });
  initObserver();

  window.addEventListener('scroll', () => {
    scheduleBlockResults(120);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.keywords) {
    scheduleBlockResults(0);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'sb-refresh') {
    scheduleBlockResults(0);
    return;
  }

  if (message?.type === 'sb-ping') {
    const config = getSiteConfig();
    sendResponse({
      supported: Boolean(config),
      engine: config?.id || null,
      stats: latestStats,
    });
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
