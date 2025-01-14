// Background service worker for the extension

// Initialize storage if empty
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['tasks'], function(result) {
    if (!result.tasks) {
      chrome.storage.sync.set({ tasks: [] });
    }
  });
});

// Example: Listen for alarms (could be used for reminders)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reminder') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Task Reminder',
      message: 'Time to check your tasks!'
    });
  }
});