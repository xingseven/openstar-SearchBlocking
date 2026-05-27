// 安装/更新时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('🔇 搜索屏蔽器已安装/更新，原因:', details.reason);

  // 确保 storage 中有 keywords 数组
  chrome.storage.sync.get({ keywords: [] }, (data) => {
    if (!Array.isArray(data.keywords)) {
      chrome.storage.sync.set({ keywords: [] });
    }
    console.log('🔇 当前屏蔽词:', data.keywords);
  });
});

// 监听 storage 变化，通知所有标签页刷新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.keywords) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: 'sb-refresh' }).catch(() => {
          // 忽略未加载 content script 的标签页
        });
      });
    });
  }
});
