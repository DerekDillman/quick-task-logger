# Quick Task Logger - MSP Edition

A powerful Chrome/Edge extension designed for MSP professionals to efficiently log and track daily tasks with enhanced categorization, metadata, and export capabilities.

## Features

### Core Functionality
- **Quick task logging** with category selection
- **Extended metadata fields**:
  - Company name
  - Ticket number
  - Additional notes
  - Related links
- **Quick Links dropdown** for frequently accessed URLs
- **Global hotkey** support (Ctrl+Shift+L / Cmd+Shift+L)
- **Full task history view** with advanced filtering

### Themes
- Light theme for bright environments
- Dark theme for reduced eye strain
- Matrix theme for that classic terminal look

### Export Options
- Export to TXT format
- Export to Markdown
- Export to CSV (from task history view)
- Timestamped filenames for easy organization

### Task Management
- Categorized tasks (Break/Fix, Administration, Network, etc.)
- Configurable task history display limit
- Search and filter capabilities
- Date range filtering
- Company and ticket filtering

## Installation

### Chrome
1. Clone this repository or download as ZIP
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

### Microsoft Edge
1. Clone this repository or download as ZIP
2. Open Edge and navigate to `edge://extensions/`
3. Enable "Developer mode" in the bottom left
4. Click "Load unpacked" and select the extension directory

## Usage

### Basic Task Logging
1. Click the extension icon or press `Ctrl+Shift+L` (Windows) / `Cmd+Shift+L` (Mac)
2. Select a category from the dropdown
3. Enter your task description
4. Optionally fill in:
   - Company name
   - Ticket number
   - Additional notes
   - Related link (or select from Quick Links)
5. Press Enter or click "Add Task"

### Viewing Task History
1. Click "📋 View All Tasks" in the extension popup
2. Use filters to find specific tasks:
   - Filter by category
   - Filter by company
   - Search by ticket number
   - Select date ranges
3. Export filtered results as CSV

### Managing Quick Links
1. Click "⚙️ Settings" in the extension popup
2. Scroll to "Quick Links" section
3. Add frequently used URLs with custom names
4. Access them quickly from the dropdown when logging tasks

### Keyboard Shortcuts
- **Open extension**: `Ctrl+Shift+L` (Windows) / `Cmd+Shift+L` (Mac)
- **Add task**: `Enter` (when in task description field)
- **Add task with line break**: `Shift+Enter`

## Configuration

### Settings Available
- **History Limit**: Number of recent tasks shown in popup (1-50)
- **Theme**: Choose between Light, Dark, or Matrix themes
- **Quick Links**: Manage your frequently accessed URLs

## Data Storage
- Tasks are stored in Chrome's sync storage
- Data syncs across devices when signed into Chrome/Edge
- Use "Clear All Tasks" in settings to reset

## File Structure
