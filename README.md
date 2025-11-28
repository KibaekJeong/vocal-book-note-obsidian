# Book Voice Capture

An Obsidian plugin that combines Kyobo (교보문고) book metadata scraping with voice-based highlight capture using OpenAI's Whisper API.

## Features

### 📚 Create Book Notes with Kyobo Metadata
- Search for books by title (Korean or English)
- Automatically scrape metadata from Kyobo (교보문고)
- Create structured book notes with frontmatter

### 🎤 Voice Highlights
- Record voice memos directly in Obsidian
- Automatic transcription via OpenAI Whisper
- Smart parsing of page numbers, quotes, and notes
- Insert formatted highlights into your book notes

## Installation

### Manual Installation
1. Download the latest release from the releases page
2. Extract the files into your vault's `.obsidian/plugins/book-voice-capture/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

### From Source
```bash
# Clone the repository
git clone https://github.com/KibaekJeong/book-voice-capture.git

# Navigate to the plugin directory
cd book-voice-capture

# Install dependencies
npm install

# Build the plugin
npm run build

# Copy main.js, manifest.json, and styles.css to your vault's plugins folder
```

## Configuration

Open Settings → Book Voice Capture to configure:

| Setting | Description | Default |
|---------|-------------|---------|
| OpenAI API Key | Your OpenAI API key for Whisper transcription | (required) |
| Whisper Model | The OpenAI Whisper model to use | `whisper-1` |
| Base Folder | Root folder that contains your Base file and book data | `Books` |
| Base File Path | Relative path (under the base folder) to your `.base` file | `Base/Books.base` |
| Book Pages Folder | Folder where book notes will be created | `Books` |
| Enable Kyobo Scraping | Fetch metadata from Kyobo when creating book notes | `true` |
| Book Note Template | Template for new book notes | See below |
| Highlight Block Template | Template for voice highlights | See below |

### Getting an OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new API key
5. Copy the key and paste it into the plugin settings

## Usage

### Quick Start: Main Command

1. Open the Command Palette (`Ctrl/Cmd + P`)
2. Search for **"Book Capture (Create or Add to Existing)"**
3. Choose one of the options:
   - **📚 Create New Book Note** - Search Kyobo and create a new book note
   - **🎤 Add Voice Note to Existing Book** - Select from your existing book notes and start recording

### Creating a Book Note

1. Open the Command Palette (`Ctrl/Cmd + P`)
2. Search for "Book Capture: Create / Open Kyobo Book Note"
3. Enter the book title (Korean or English)
4. The plugin will:
   - Search Kyobo for the book
   - Scrape metadata (title, author, publisher, etc.)
  - Create a new note in your configured Book Pages folder
   - Open the note

### Adding Voice Notes to Existing Books

1. Open the Command Palette (`Ctrl/Cmd + P`)
2. Search for **"Book Capture: Add Voice Note to Existing Book"**
3. A fuzzy search modal will appear with all your book notes
4. Type to search and select a book
5. The book note will open and recording starts automatically
6. Speak your highlight and click "Stop & Transcribe"

### Adding Voice Highlights (Current Note)

1. Open a book note (must have `type: book` in frontmatter)
2. Open the Command Palette (`Ctrl/Cmd + P`)
3. Search for "Book Capture: Add Voice Highlight (Current Note)"
4. A recording modal will appear
5. Speak your highlight in this format:

   **페이지 [번호]. 인용문: [인용할 내용]. 메모: [내 생각/메모]**

   Example:
   > "페이지 42. 인용문: 시간은 우리가 만드는 것이다. 메모: 이 문장이 정말 인상 깊었다. 시간 관리의 핵심을 잘 표현하고 있다."

6. Click "Stop & Transcribe"
7. The plugin will:
   - Transcribe your recording using Whisper
   - Parse the page number, quote, and note
   - Insert a formatted highlight block into your note

### Speech Pattern Examples

The plugin supports various speech patterns:

| Pattern | Example |
|---------|---------|
| Full format | "페이지 42. 인용문: ... 메모: ..." |
| Quote only | "페이지 42. 인용문: ..." |
| Note only | "페이지 42. 메모: ..." |
| Simple | "페이지 42. ..." (treated as note) |
| Fallback | Any text (treated as note, no page) |

## Templates

### Default Book Note Template

```markdown
---
Type: Book
Area: ""
Goal: ""
Status: "reading"
title: "{{title}}"
author: "{{author}}"
publisher: "{{publisher}}"
published: "{{publishedDate}}"
isbn: "{{isbn}}"
cover: "{{coverImage}}"
url: "{{kyoboUrl}}"
Topics: "{{topics}}"
Genre: "{{genre}}"
Rating: "{{rating}}"
'start reading': "{{currentDate}}"
'end reading': ""
Description: "{{description}}"
source: "Kyobo"
---

# {{title}}

## 기본 정보

- 저자: {{author}}
- 출판사: {{publisher}}
- 출간일: {{publishedDate}}
- ISBN: {{isbn}}
- Kyobo: {{kyoboUrl}}

## 핵심 요약

- 

## 인상 깊은 문장 & 메모 (Voice)

```

### Default Highlight Block Template

```markdown
### p.{{page}}

> {{quote}}

- 메모: {{note}}
- 캡처일: {{date}}

```

### Available Placeholders

**Book Note Template:**
- `{{title}}` - Book title
- `{{author}}` - Author name
- `{{publisher}}` - Publisher name
- `{{publishedDate}}` - Publication date
- `{{isbn}}` - ISBN number
- `{{kyoboUrl}}` - Kyobo book page URL
- `{{coverImage}}` / `{{image}}` - Cover image URL
- `{{topics}}` - Topics or keywords parsed from Kyobo
- `{{genre}}` - Genre/category information
- `{{rating}}` - Kyobo rating (if available)
- `{{description}}` - Kyobo description/summary
- `{{currentDate}}` - Today's date (YYYY-MM-DD)

**Highlight Block Template:**
- `{{page}}` - Page number
- `{{quote}}` - The quoted text
- `{{note}}` - Your note/memo
- `{{date}}` - Capture date (YYYY-MM-DD)

## Available Commands

| Command | Description |
|---------|-------------|
| **Book Capture (Create or Add to Existing)** | Main entry point - choose to create new book or add to existing |
| **Create / Open Kyobo Book Note** | Search Kyobo and create/open a book note |
| **Add Voice Note to Existing Book** | Select an existing book and start recording |
| **Add Voice Highlight (Current Note)** | Add voice highlight to the currently open book note |

## Troubleshooting

### Kyobo scraping not working
- Kyobo may change their website structure periodically
- Check the console (`Ctrl/Cmd + Shift + I`) for error messages
- Try disabling Kyobo scraping and entering metadata manually

### Voice recording not working
- Ensure your browser/Obsidian has microphone permissions
- Check that your microphone is working in other applications
- On mobile, grant microphone permission when prompted

### Transcription errors
- Ensure your OpenAI API key is valid and has credits
- Speak clearly and in a quiet environment
- The Whisper model works best with clear Korean speech

### API key errors
- Double-check your API key in settings
- Ensure your OpenAI account has available credits
- Check if your API key has the correct permissions

## Development

```bash
# Install dependencies
npm install

# Development mode (watch for changes)
npm run dev

# Production build
npm run build
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details.

## Credits

- Inspired by [snipd-obsidian](https://github.com/KibaekJeong/snipd-obsidian)
- Voice recording approach from [whisper-obsidian-plugin](https://github.com/nikdanilov/whisper-obsidian-plugin)
- Kyobo (교보문고) for book metadata

## Support

If you find this plugin helpful, consider:
- ⭐ Starring the repository
- 🐛 Reporting issues
- 💡 Suggesting new features

