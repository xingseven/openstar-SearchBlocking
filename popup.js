document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('keywordInput');
  const addBtn = document.getElementById('addBtn');
  const list = document.getElementById('keywordList');
  const countLabel = document.getElementById('countLabel');
  const clearBtn = document.getElementById('clearBtn');
  const statusLabel = document.getElementById('statusLabel');

  function setStatus(text, type = '') {
    statusLabel.textContent = text;
    statusLabel.className = `status ${type}`.trim();
  }

  async function checkInjectionStatus() {
    setStatus('正在检测当前页面注入状态...');

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab?.id) {
      setStatus('未找到活动标签页。', 'warn');
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'sb-ping' });
      if (response?.supported) {
        const stats = response.stats || {};
        const results = Number.isFinite(stats.results) ? stats.results : 0;
        const blocked = Number.isFinite(stats.blocked) ? stats.blocked : 0;
        setStatus(
          `已注入：${response.engine || '搜索页'}，已隐藏 ${blocked}/${results} 条结果。`,
          'ok'
        );
      } else {
        setStatus('当前页面不是受支持的搜索结果页。', 'warn');
      }
    } catch (error) {
      setStatus('当前页未注入脚本，请刷新页面或将扩展网站访问权限设为“在所有网站上”。', 'warn');
    }
  }

  // 加载关键词
  async function loadKeywords() {
    const data = await chrome.storage.sync.get({ keywords: [] });
    renderList(Array.isArray(data.keywords) ? data.keywords : []);
  }

  // 渲染列表
  function renderList(keywords) {
    if (keywords.length === 0) {
      list.innerHTML = '<li class="empty">还没有屏蔽词，在上方添加</li>';
      countLabel.textContent = '共 0 个屏蔽词';
      return;
    }

    list.innerHTML = keywords
      .map(
        (kw, i) => `
      <li>
        <span class="keyword-text">${escapeHtml(kw)}</span>
        <button class="btn-secondary" data-index="${i}">删除</button>
      </li>`
      )
      .join('');

    countLabel.textContent = `共 ${keywords.length} 个屏蔽词`;

    // 删除事件
    list.querySelectorAll('.btn-secondary').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number.parseInt(btn.dataset.index, 10);
        const data = await chrome.storage.sync.get({ keywords: [] });
        data.keywords.splice(idx, 1);
        await chrome.storage.sync.set({ keywords: data.keywords });
        renderList(data.keywords);
        notifyContentScript();
        checkInjectionStatus();
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // 添加关键词
  async function addKeyword() {
    const keyword = input.value.trim();
    if (!keyword) return;

    const data = await chrome.storage.sync.get({ keywords: [] });
    const exists = data.keywords.some(
      (item) => item.trim().toLowerCase() === keyword.toLowerCase()
    );
    if (exists) {
      input.value = '';
      return;
    }

    data.keywords.push(keyword);
    await chrome.storage.sync.set({ keywords: data.keywords });
    input.value = '';
    renderList(data.keywords);
    notifyContentScript();
    checkInjectionStatus();
  }

  // 通知 content script 刷新
  function notifyContentScript() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'sb-refresh' }).catch(() => {
          // 内容脚本也会监听 storage 变化，这里失败不影响主流程。
        });
      }
    });
  }

  // 清空全部
  clearBtn.addEventListener('click', async () => {
    if (!confirm('确定清空所有屏蔽词？')) return;
    await chrome.storage.sync.set({ keywords: [] });
    renderList([]);
    notifyContentScript();
    checkInjectionStatus();
  });

  // 事件绑定
  addBtn.addEventListener('click', addKeyword);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addKeyword();
  });

  loadKeywords();
  checkInjectionStatus();
});
