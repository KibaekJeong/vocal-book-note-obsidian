import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  TFile,
  TFolder,
  FuzzySuggestModal,
} from "obsidian";

import {
  BookVoiceCaptureSettings,
  DEFAULT_SETTINGS,
  BookVoiceCaptureSettingTab,
} from "./src/settings";
import { fetchKyoboMeta, BookMeta } from "./src/kyobo";
import {
  RecordingModal,
  transcribeAudio,
  parseTranscription,
} from "./src/voice";
import { renderBookNoteTemplate, renderHighlightTemplate } from "./src/templates";
import {
  sanitizeFilename,
  isBookNote,
  insertAtHighlightSection,
  ensureFolderExists,
  getBookNotePath,
  getFrontmatterValue,
} from "./src/util";

/**
 * Represents a book note file with its metadata
 */
interface BookNoteItem {
  file: TFile;
  title: string;
  author: string;
}

/**
 * Modal for entering book title search query
 */
class BookSearchModal extends Modal {
  private inputEl: HTMLInputElement | null = null;
  private onSubmit: (query: string) => void;

  constructor(app: App, onSubmit: (query: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Create / Open Book Note" });
    contentEl.createEl("p", { text: "Enter the book title to search on Kyobo:" });

    this.inputEl = contentEl.createEl("input", {
      type: "text",
      placeholder: "Book title (Korean or English)...",
    });
    this.inputEl.style.width = "100%";
    this.inputEl.style.marginBottom = "16px";
    this.inputEl.style.padding = "8px";

    // Handle Enter key
    this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        this.submit();
      }
    });

    const buttonsEl = contentEl.createDiv({ cls: "modal-button-container" });
    buttonsEl.style.display = "flex";
    buttonsEl.style.justifyContent = "flex-end";
    buttonsEl.style.gap = "8px";

    const cancelBtn = buttonsEl.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = (): void => this.close();

    const submitBtn = buttonsEl.createEl("button", { text: "Search & Create", cls: "mod-cta" });
    submitBtn.onclick = (): void => this.submit();

    // Focus input
    this.inputEl.focus();
  }

  private submit(): void {
    const query = this.inputEl?.value.trim();
    if (query) {
      this.close();
      this.onSubmit(query);
    } else {
      new Notice("Please enter a book title");
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Modal for selecting an existing book note
 */
class BookSelectModal extends FuzzySuggestModal<BookNoteItem> {
  private bookNotes: BookNoteItem[];
  private onChoose: (item: BookNoteItem) => void;

  constructor(app: App, bookNotes: BookNoteItem[], onChoose: (item: BookNoteItem) => void) {
    super(app);
    this.bookNotes = bookNotes;
    this.onChoose = onChoose;
    this.setPlaceholder("Search for a book note...");
  }

  getItems(): BookNoteItem[] {
    return this.bookNotes;
  }

  getItemText(item: BookNoteItem): string {
    if (item.author) {
      return `${item.title} - ${item.author}`;
    }
    return item.title;
  }

  onChooseItem(item: BookNoteItem, evt: MouseEvent | KeyboardEvent): void {
    this.onChoose(item);
  }
}

/**
 * Modal for choosing action: Create new book or Add to existing
 */
class BookActionModal extends Modal {
  private onCreateNew: () => void;
  private onAddToExisting: () => void;
  private hasExistingBooks: boolean;

  constructor(
    app: App,
    hasExistingBooks: boolean,
    onCreateNew: () => void,
    onAddToExisting: () => void
  ) {
    super(app);
    this.hasExistingBooks = hasExistingBooks;
    this.onCreateNew = onCreateNew;
    this.onAddToExisting = onAddToExisting;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("book-voice-capture-action-modal");

    contentEl.createEl("h3", { text: "Book Voice Capture" });
    contentEl.createEl("p", { text: "What would you like to do?" });

    const buttonsEl = contentEl.createDiv({ cls: "book-voice-capture-action-buttons" });
    buttonsEl.style.display = "flex";
    buttonsEl.style.flexDirection = "column";
    buttonsEl.style.gap = "12px";
    buttonsEl.style.marginTop = "16px";

    // Create New Book button
    const createNewBtn = buttonsEl.createEl("button", {
      text: "📚 Create New Book Note",
      cls: "mod-cta",
    });
    createNewBtn.style.padding = "12px 24px";
    createNewBtn.style.fontSize = "1em";
    createNewBtn.onclick = (): void => {
      this.close();
      this.onCreateNew();
    };

    // Add to Existing Book button
    const addToExistingBtn = buttonsEl.createEl("button", {
      text: "🎤 Add Voice Note to Existing Book",
    });
    addToExistingBtn.style.padding = "12px 24px";
    addToExistingBtn.style.fontSize = "1em";
    
    if (!this.hasExistingBooks) {
      addToExistingBtn.disabled = true;
      addToExistingBtn.style.opacity = "0.5";
      addToExistingBtn.title = "No existing book notes found";
    } else {
      addToExistingBtn.onclick = (): void => {
        this.close();
        this.onAddToExisting();
      };
    }

    // Cancel button
    const cancelBtn = buttonsEl.createEl("button", { text: "Cancel" });
    cancelBtn.style.padding = "8px 16px";
    cancelBtn.onclick = (): void => this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Book Voice Capture Plugin
 * Creates Kyobo-based book notes and adds voice highlights via Whisper
 */
export default class BookVoiceCapturePlugin extends Plugin {
  settings: BookVoiceCaptureSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    console.log("[Book Voice Capture] Loading plugin...");

    await this.loadSettings();

    // Add settings tab
    this.addSettingTab(new BookVoiceCaptureSettingTab(this.app, this));

    // Command: Book Capture (main entry point with action choice)
    this.addCommand({
      id: "book-voice-capture-main",
      name: "Book Capture (Create or Add to Existing)",
      callback: () => this.showActionModal(),
    });

    // Command: Create or Open Book Note
    this.addCommand({
      id: "book-voice-capture-create-or-open-book",
      name: "Create / Open Kyobo Book Note",
      callback: () => this.createOrOpenBookNote(),
    });

    // Command: Add Voice Note to Existing Book
    this.addCommand({
      id: "book-voice-capture-add-to-existing",
      name: "Add Voice Note to Existing Book",
      callback: () => this.addVoiceNoteToExistingBook(),
    });

    // Command: Add Voice Highlight (for current note)
    this.addCommand({
      id: "book-voice-capture-add-voice-highlight",
      name: "Add Voice Highlight (Current Note)",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.addVoiceHighlight(editor, view);
      },
    });

    console.log("[Book Voice Capture] Plugin loaded successfully");
  }

  onunload(): void {
    console.log("[Book Voice Capture] Unloading plugin...");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Get all book notes from the books folder
   */
  private async getBookNotes(): Promise<BookNoteItem[]> {
    const bookNotes: BookNoteItem[] = [];
    const booksFolder = this.app.vault.getAbstractFileByPath(this.settings.booksFolder);

    if (!booksFolder || !(booksFolder instanceof TFolder)) {
      return bookNotes;
    }

    // Recursively get all markdown files in the books folder
    const processFolder = async (folder: TFolder): Promise<void> => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === "md") {
          try {
            const content = await this.app.vault.read(child);
            if (isBookNote(content)) {
              const title = getFrontmatterValue(content, "title") || child.basename;
              const author = getFrontmatterValue(content, "author") || "";
              bookNotes.push({ file: child, title, author });
            }
          } catch (error) {
            console.error(`[Book Voice Capture] Error reading ${child.path}:`, error);
          }
        } else if (child instanceof TFolder) {
          await processFolder(child);
        }
      }
    };

    await processFolder(booksFolder);
    
    // Sort by title
    bookNotes.sort((a, b) => a.title.localeCompare(b.title));
    
    return bookNotes;
  }

  /**
   * Show the action choice modal
   */
  private async showActionModal(): Promise<void> {
    const bookNotes = await this.getBookNotes();
    const hasExistingBooks = bookNotes.length > 0;

    new BookActionModal(
      this.app,
      hasExistingBooks,
      () => this.createOrOpenBookNote(),
      () => this.addVoiceNoteToExistingBook()
    ).open();
  }

  /**
   * Command handler: Add Voice Note to Existing Book
   */
  private async addVoiceNoteToExistingBook(): Promise<void> {
    // Check API key first
    if (!this.settings.openAIApiKey) {
      new Notice("Please set your OpenAI API key in Book Voice Capture settings.");
      return;
    }

    const bookNotes = await this.getBookNotes();

    if (bookNotes.length === 0) {
      new Notice("No book notes found. Create a book note first.");
      return;
    }

    // Show book selection modal
    new BookSelectModal(this.app, bookNotes, async (item: BookNoteItem) => {
      await this.openBookAndStartRecording(item.file);
    }).open();
  }

  /**
   * Open a book note and start voice recording
   */
  private async openBookAndStartRecording(file: TFile): Promise<void> {
    // Open the file
    await this.app.workspace.openLinkText(file.path, "", false);

    // Wait for the file to be opened and editor to be ready
    setTimeout(async () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        new Notice("Failed to open book note");
        return;
      }

      const editor = view.editor;
      const content = editor.getValue();

      // Verify it's a book note
      if (!isBookNote(content)) {
        new Notice("Selected file is not a valid book note");
        return;
      }

      // Start recording
      new RecordingModal(
        this.app,
        async (audioBlob: Blob) => {
          await this.processVoiceRecording(audioBlob, editor, content);
        },
        () => {
          new Notice("Recording cancelled");
        }
      ).open();
    }, 200);
  }

  /**
   * Command handler: Create or Open Book Note
   */
  private createOrOpenBookNote(): void {
    new BookSearchModal(this.app, async (query: string) => {
      await this.processBookSearch(query);
    }).open();
  }

  /**
   * Process book search and create/open note
   */
  private async processBookSearch(query: string): Promise<void> {
    new Notice(`Searching for "${query}"...`);

    let meta: BookMeta | null = null;

    // Try to fetch metadata from Kyobo if enabled
    if (this.settings.kyoboEnabled) {
      try {
        meta = await fetchKyoboMeta(query);
        if (meta) {
          new Notice(`Found: ${meta.title}`);
        } else {
          new Notice("Book not found on Kyobo, creating note with title only");
        }
      } catch (error) {
        console.error("[Book Voice Capture] Kyobo fetch error:", error);
        new Notice("Kyobo search failed, creating note with title only");
      }
    }

    // If no metadata, use the query as title
    if (!meta) {
      meta = {
        title: query,
        author: "",
      };
    }

    // Determine the file path
    const notePath = getBookNotePath(this.settings.booksFolder, meta.title);

    // Check if file already exists
    const existingFile = this.app.vault.getAbstractFileByPath(notePath);

    if (existingFile instanceof TFile) {
      // File exists, open it
      await this.app.workspace.openLinkText(notePath, "", false);
      new Notice(`Opened existing note: ${meta.title}`);
      
      // Move cursor to end of file
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        const editor = view.editor;
        const lastLine = editor.lastLine();
        editor.setCursor({ line: lastLine, ch: editor.getLine(lastLine).length });
      }
    } else {
      // Create new file
      await this.createBookNote(meta);
    }
  }

  /**
   * Create a new book note with the given metadata
   */
  private async createBookNote(meta: BookMeta): Promise<void> {
    try {
      // Ensure the books folder exists
      await ensureFolderExists(this.app, this.settings.booksFolder);

      // Render the template
      const content = renderBookNoteTemplate(this.settings.bookNoteTemplate, meta);

      // Create the file
      const notePath = getBookNotePath(this.settings.booksFolder, meta.title);
      await this.app.vault.create(notePath, content);

      // Open the new file
      await this.app.workspace.openLinkText(notePath, "", false);

      new Notice(`Created book note: ${meta.title}`);

      // Move cursor to end of file (ready for highlights)
      setTimeout(() => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          const editor = view.editor;
          const lastLine = editor.lastLine();
          editor.setCursor({ line: lastLine, ch: editor.getLine(lastLine).length });
        }
      }, 100);

    } catch (error) {
      console.error("[Book Voice Capture] Failed to create book note:", error);
      new Notice("Failed to create book note. Check console for details.");
    }
  }

  /**
   * Command handler: Add Voice Highlight (current note)
   */
  private addVoiceHighlight(editor: Editor, view: MarkdownView): void {
    // Check API key
    if (!this.settings.openAIApiKey) {
      new Notice("Please set your OpenAI API key in Book Voice Capture settings.");
      return;
    }

    // Check if current file is a book note
    const content = editor.getValue();
    if (!isBookNote(content)) {
      new Notice("Active note is not a book note (missing 'type: book' in frontmatter).");
      return;
    }

    // Start recording
    new RecordingModal(
      this.app,
      async (audioBlob: Blob) => {
        await this.processVoiceRecording(audioBlob, editor, content);
      },
      () => {
        // Recording cancelled
        new Notice("Recording cancelled");
      }
    ).open();
  }

  /**
   * Process voice recording: transcribe and insert highlight
   */
  private async processVoiceRecording(audioBlob: Blob, editor: Editor, originalContent: string): Promise<void> {
    new Notice("Transcribing audio...");

    try {
      // Transcribe the audio
      const transcribedText = await transcribeAudio(
        audioBlob,
        this.settings.openAIApiKey,
        this.settings.openAIWhisperModel
      );

      if (!transcribedText) {
        new Notice("Transcription returned empty result");
        return;
      }

      new Notice(`Transcribed: "${transcribedText.substring(0, 50)}..."`);

      // Parse the transcription
      const parsed = parseTranscription(transcribedText);

      // Render the highlight block
      const highlightBlock = renderHighlightTemplate(
        this.settings.highlightBlockTemplate,
        parsed
      );

      // Insert into the editor
      const currentContent = editor.getValue();
      insertAtHighlightSection(
        editor,
        currentContent,
        highlightBlock,
        "## 인상 깊은 문장 & 메모 (Voice)"
      );

      new Notice("Voice highlight added!");

    } catch (error) {
      console.error("[Book Voice Capture] Voice highlight error:", error);
      if (error instanceof Error) {
        new Notice(`Error: ${error.message}`);
      } else {
        new Notice("Failed to add voice highlight. Check console for details.");
      }
    }
  }
}
