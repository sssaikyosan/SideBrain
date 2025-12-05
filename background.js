chrome.action.onClicked.addListener((tab) => {
    // Open the side panel
    if (typeof browser !== 'undefined' && browser.sidebarAction) {
        browser.sidebarAction.open();
    } else if (chrome.sidePanel) {
        chrome.sidePanel.open({ tabId: tab.id });
    }
});
