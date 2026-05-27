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
      '#b_context > li',
      '#b_context .b_ans',
      '#b_context .b_algo',
      '#b_context .b_entityTP',
      '#b_context .b_rich',
      '#b_dynRail > li',
      '#b_dynRail .b_ans',
      '#b_dynRail .b_algo',
      '#b_dynRail .b_entityTP',
      '#b_dynRail .b_rich',
      '#b_pole .b_ans',
      '#b_pole .b_algo',
      '#b_pole .b_entityTP',
    ],
    closestSelectors: [
      'li.b_algo',
      'li.b_ans',
      '.b_algo',
      '.b_ans',
      '.b_entityTP',
      '.b_rich',
      '#b_context > li',
      '#b_dynRail > li',
      'li[data-bm]',
      '[data-card]',
      '[data-card-index]',
      '#b_results > li',
      '#b_topw li',
      '#b_pole li',
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
  fallbackBlocked: 0,
  supported: false,
};
const ROOT_CONTAINER_IDS = new Set([
  'b_content',
  'b_results',
  'b_context',
  'b_dynRail',
  'b_topw',
  'b_pole',
  'b_tween',
  'b_header',
  'b_footer',
  'sb_form',
  'search',
  'rso',
  'content_left',
]);
const BING_FALLBACK_ROOT_SELECTORS = ['#b_context', '#b_dynRail', '#b_topw', '#b_pole', '#b_content'];
const BING_FALLBACK_CARD_SELECTOR = 'div, li, article, section, aside';
const BING_FALLBACK_HINT_SELECTOR = [
  '.b_entityTP',
  '.b_rich',
  '.b_ans',
  '.b_algo',
  '.b_card',
  '[data-bm]',
  '[data-card]',
  '[data-card-index]',
].join(', ');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toCompact(value) {
  return normalizeText(value).replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, '');
}

function decodeBingRedirectUrl(urlValue) {
  try {
    const parsed = new URL(urlValue, window.location.href);
    if (!/(^|\.)bing\.com$/i.test(parsed.hostname) || parsed.pathname !== '/ck/a') {
      return parsed.href;
    }

    const encodedParam = parsed.searchParams.get('u');
    if (!encodedParam || encodedParam.length <= 2) {
      return parsed.href;
    }

    const encoded = encodedParam
      .slice(2)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4);
    const decoded = atob(padded);
    return decoded || parsed.href;
  } catch {
    return String(urlValue || '');
  }
}

function toUrlMatchText(urlValue) {
  try {
    const parsed = new URL(urlValue, window.location.href);
    return `${parsed.href} ${parsed.hostname}${parsed.pathname}`;
  } catch {
    return String(urlValue || '');
  }
}

function isRootContainer(element) {
  if (!(element instanceof HTMLElement)) {
    return true;
  }

  if (element === document.body || element === document.documentElement) {
    return true;
  }

  if (ROOT_CONTAINER_IDS.has(element.id)) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  if (['html', 'body', 'main'].includes(tagName)) {
    return true;
  }

  return false;
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

  if (isRootContainer(element)) {
    return false;
  }

  const text = normalizeText(element.textContent);
  if (!text) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const tooLarge =
    viewportWidth > 0 &&
    viewportHeight > 0 &&
    rect.width >= viewportWidth * 0.96 &&
    rect.height >= viewportHeight * 0.55;

  if (tooLarge) {
    return false;
  }

  return rect.height >= 24 || rect.width >= 80 || text.length >= 12;
}

function hasCardStructure(element) {
  const hasHeading = element.querySelector('h1, h2, h3, h4, strong, [role="heading"]');
  const hasSource = element.querySelector('cite, [class*="source"], [class*="attribution"]');
  const hasResultLink = element.querySelector('a[href], [data-href], [data-url]');
  const hasListItem = element.querySelector('ul li, ol li');
  return Boolean(hasHeading || hasSource || hasResultLink || hasListItem);
}

function dedupeResults(elements) {
  const ordered = [...new Set(elements)].sort(
    (left, right) => getElementDepth(right) - getElementDepth(left)
  );
  const results = [];

  ordered.forEach((element) => {
    if (!isResultCandidate(element)) {
      return;
    }

    if (
      results.some(
        (existing) =>
          existing === element || existing.contains(element) || element.contains(existing)
      )
    ) {
      return;
    }

    results.push(element);
  });

  return results;
}

function getClosestByPriority(element, selectors) {
  for (const selector of selectors) {
    const matched = element.closest(selector);
    if (matched instanceof HTMLElement) {
      return matched;
    }
  }

  return element;
}

function collectBySelectors(resultSelectors, closestSelectors) {
  const results = new Set();

  resultSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      const container = getClosestByPriority(element, closestSelectors);
      if (container instanceof HTMLElement) {
        results.add(container);
      }
    });
  });

  return dedupeResults(results);
}

function genericScan(config) {
  const results = new Set();
  const links = document.querySelectorAll('a[href], [data-href], [data-url]');

  links.forEach((link) => {
    const href =
      link.getAttribute('href') ||
      link.getAttribute('data-href') ||
      link.getAttribute('data-url') ||
      '';
    if (!href) {
      return;
    }

    const matched =
      link.closest && config.closestSelectors.length > 0
        ? getClosestByPriority(link, config.closestSelectors)
        : null;
    if (matched instanceof HTMLElement) {
      results.add(matched);
      return;
    }

    let parent = link.parentElement;
    let depth = 0;

    while (parent && depth < 10) {
      if (isRootContainer(parent)) {
        break;
      }

      const tagName = parent.tagName.toLowerCase();
      const text = normalizeText(parent.textContent);

      if (
        ['article', 'div', 'li'].includes(tagName) &&
        text.length >= 12 &&
        hasCardStructure(parent)
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

function findBingFallbackCandidates(existingResults) {
  const knownResults = new Set(existingResults);
  const candidates = new Set();
  const roots = BING_FALLBACK_ROOT_SELECTORS.map((selector) => document.querySelector(selector)).filter(
    (root) => root instanceof HTMLElement
  );

  roots.forEach((root) => {
    root.querySelectorAll(BING_FALLBACK_CARD_SELECTOR).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      if (isRootContainer(node)) {
        return;
      }

      const hinted = node.closest(BING_FALLBACK_HINT_SELECTOR);
      let card = hinted instanceof HTMLElement ? hinted : node;
      let climb = card.parentElement;
      let depth = 0;

      while (climb && depth < 6 && !isRootContainer(climb)) {
        if (climb.matches(BING_FALLBACK_HINT_SELECTOR)) {
          card = climb;
        }
        climb = climb.parentElement;
        depth += 1;
      }

      if (
        !knownResults.has(card) &&
        isResultCandidate(card) &&
        hasCardStructure(card)
      ) {
        candidates.add(card);
      }
    });
  });

  return dedupeResults(candidates);
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

function collectMatchPieces(element) {
  const pieces = [element.textContent || ''];

  element.querySelectorAll('a[href], cite').forEach((node) => {
    if (node.textContent) {
      pieces.push(node.textContent);
    }

    if (node instanceof HTMLAnchorElement && node.href) {
      const decodedHref = decodeBingRedirectUrl(node.href);
      pieces.push(toUrlMatchText(decodedHref));
      pieces.push(toUrlMatchText(node.href));
    }
  });

  element.querySelectorAll('[data-url], [data-href]').forEach((node) => {
    const dataUrl = node.getAttribute('data-url') || node.getAttribute('data-href') || '';
    if (dataUrl) {
      const decoded = decodeBingRedirectUrl(dataUrl);
      pieces.push(toUrlMatchText(decoded));
    }
  });

  return pieces;
}

function matchesKeyword(element, keywords) {
  const normalized = normalizeText(collectMatchPieces(element).join(' '));
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
      fallbackBlocked: 0,
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
      fallbackBlocked: 0,
      supported: true,
    };
    return;
  }

  const directResults = findResults(config);
  const fallbackResults =
    config.id === 'bing' ? findBingFallbackCandidates(directResults) : [];
  const fallbackSet = new Set(fallbackResults);
  const results = dedupeResults([...directResults, ...fallbackResults]);
  if (results.length === 0) {
    latestStats = {
      engine: config.id,
      keywords: keywords.length,
      results: 0,
      blocked: 0,
      fallbackBlocked: 0,
      supported: true,
    };
    console.debug('[Search Blocker] no result candidates found for', config.id);
    return;
  }

  let blockedCount = 0;
  let fallbackBlockedCount = 0;

  results.forEach((result) => {
    const shouldBlock = matchesKeyword(result, keywords);
    setBlockedState(result, shouldBlock);

    if (shouldBlock) {
      blockedCount += 1;
      if (fallbackSet.has(result)) {
        fallbackBlockedCount += 1;
      }
    }
  });

  console.debug(
    `[Search Blocker] ${config.id}: hidden ${blockedCount}/${results.length} results (fallback ${fallbackBlockedCount})`
  );
  latestStats = {
    engine: config.id,
    keywords: keywords.length,
    results: results.length,
    blocked: blockedCount,
    fallbackBlocked: fallbackBlockedCount,
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
