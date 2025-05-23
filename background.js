// Background service worker for the extension

// Initialize storage with default values if empty
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['tasks', 'settings'], function(result) {
    // Initialize tasks if not present
    if (!result.tasks) {
      chrome.storage.sync.set({ tasks: [] });
    }
    
    // Initialize settings with defaults if not present
    if (!result.settings) {
      const defaultSettings = {
        historyLimit: 10,
        theme: 'matrix',
        templates: [
          { text: "Password reset for user", category: "Break/Fix" },
          { text: "Office 365 license assignment", category: "Administration" },
          { text: "Firewall rule update", category: "Network" },
          { text: "Server patch installation", category: "Maintenance" },
          { text: "Backup verification", category: "Maintenance" },
          { text: "Ticket review and response", category: "Support" },
          { text: "Antivirus alert investigation", category: "Security" },
          { text: "New user onboarding", category: "Project" },
          { text: "Email issue troubleshooting", category: "Break/Fix" },
          { text: "Remote support session", category: "Support" }
        ],
        categories: ["Break/Fix", "Administration", "Network", "Maintenance", "Support", "Security", "Project", "Meeting", "Documentation"]
      };
      chrome.storage.sync.set({ settings: defaultSettings });
    }
  });
});

// Handle keyboard shortcut command
chrome.commands.onCommand.addListener((command) => {
  if (command === "_execute_action") {
    // Create a new window with the popup
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 400,
      height: 600
    });
  }
});

// Optional: Set up alarm for task reminders
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'taskReminder') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Task Logger Reminder',
      message: 'Remember to log your current task!',
      priority: 1
    });
  }
});
