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
  EventRef,
  normalizePath,
} from "obsidian";

import {
  BookVoiceCaptureSettings,
  DEFAULT_SETTINGS,
  BookVoiceCaptureSettingTab,
} from "./src/settings";
import {
  fetchKyoboMeta,
  fetchKyoboSearchCandidates,
  fetchKyoboDetailMeta,
  BookMeta,
  KyoboSearchCandidate,
} from "./src/kyobo";
import {
  RecordingModal,
  transcribeAudio,
  parseTranscription,
} from "./src/voice";
import {
  renderBookNoteTemplate,
  renderHighlightTemplate,
  createClippingPlaceholder,
  CLIPPING_PLACEHOLDER_MARKER,
} from "./src/templates";
import {
  generateGptSummary,
  formatGptSummarySection,
  formatGptSummaryUnavailable,
  hasGptSummarySection,
  insertGptSummaryIntoContent,
} from "./src/gpt-summary";
import {
  isBookNote,
  isBookNoteFromCache,
  insertHighlightBlock,
  ensureFolderExists,
  getBookNotePath,
  getFrontmatterValueFromCache,
  moveCursorToHighlightSection,
  replacePlaceholder,
  removePlaceholderBlock,
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
 * Modal for selecting a Kyobo search candidate
 */
class KyoboCandidateModal extends FuzzySuggestModal<KyoboSearchCandidate> {
  private candidates: KyoboSearchCandidate[];
  private onChoose: (candidate: KyoboSearchCandidate) => void;

  constructor(
    app: App,
    candidates: KyoboSearchCandidate[],
    onChoose: (candidate: KyoboSearchCandidate) => void
  ) {
    super(app);
    this.candidates = candidates;
    this.onChoose = onChoose;
    this.setPlaceholder("Select a book from search results...");
  }

  getItems(): KyoboSearchCandidate[] {
    return this.candidates;
  }

  getItemText(item: KyoboSearchCandidate): string {
    const parts: string[] = [item.title];
    if (item.author) {
      parts.push(`by ${item.author}`);
    }
    if (item.publisher) {
      parts.push(`(${item.publisher})`);
    }
    if (item.publishedYear) {
      parts.push(`[${item.publishedYear}]`);
    }
    return parts.join(" ");
  }

  onChooseItem(item: KyoboSearchCandidate, evt: MouseEvent | KeyboardEvent): void {
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

    // Add ribbon icon for main command
    this.addRibbonIcon("book-open", "Book Voice Capture", () => {
      this.showActionModal();
    });

    // Add ribbon icon for quick voice recording to existing book
    this.addRibbonIcon("mic", "Add Voice Note to Book", () => {
      this.addVoiceNoteToExistingBook();
    });

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
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    if (!this.settings.baseFolder) {
      this.settings.baseFolder = DEFAULT_SETTINGS.baseFolder;
    }
    if (!this.settings.baseFilePath) {
      this.settings.baseFilePath = DEFAULT_SETTINGS.baseFilePath;
    }
    if (!this.settings.dataFolder) {
      this.settings.dataFolder = this.settings.booksFolder || DEFAULT_SETTINGS.booksFolder;
    }
    if (!this.settings.booksFolder) {
      this.settings.booksFolder = this.settings.dataFolder || DEFAULT_SETTINGS.booksFolder;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Resolve the folder path where book notes should be stored.
   * Prefers the dedicated data folder, then the legacy books folder,
   * and finally derives a Data subfolder from the base folder.
   */
  private getBookPagesFolder(): string {
    const dataFolder = this.settings.dataFolder?.trim();
    if (dataFolder) {
      return dataFolder;
    }

    const legacyBooksFolder = this.settings.booksFolder?.trim();
    if (legacyBooksFolder) {
      return legacyBooksFolder;
    }

    const baseFolder = this.settings.baseFolder?.trim();
    if (baseFolder) {
      return `${baseFolder}/Data`;
    }

    return DEFAULT_SETTINGS.booksFolder;
  }

  private getBaseFolderPath(): string {
    const folder = this.settings.baseFolder?.trim() || DEFAULT_SETTINGS.baseFolder;
    return folder.replace(/\/+$/, "");
  }

  private getBaseFileVaultPath(): string {
    const baseFolder = this.getBaseFolderPath();
    const relative = this.settings.baseFilePath?.trim() || DEFAULT_SETTINGS.baseFilePath;
    return normalizePath(`${baseFolder}/${relative}`);
  }

  /**
   * Get all book notes from the books folder.
   * Uses a staged approach for reliability:
   * 1. First pass: use metadataCache (fast, works for most files)
   * 2. Fallback: for files without cache, collect them for lazy validation
   * 3. If cache returned nothing but there are .md files, do content-based check
   * 
   * This ensures existing book notes appear even on cold start or large vaults.
   */
  private getBookNotes(): BookNoteItem[] {
    const bookNotes: BookNoteItem[] = [];
    const uncachedFiles: TFile[] = [];
    const bookFolderPath = this.getBookPagesFolder();
    const booksFolder = this.app.vault.getAbstractFileByPath(bookFolderPath);

    if (!booksFolder || !(booksFolder instanceof TFolder)) {
      return bookNotes;
    }

    // Recursively get all markdown files in the books folder
    const processFolder = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === "md") {
          // Try cache first (fast path)
          const cache = this.app.metadataCache.getFileCache(child);
          
          if (cache?.frontmatter) {
            // Cache available - use it
            if (isBookNoteFromCache(this.app, child)) {
              const title = getFrontmatterValueFromCache(this.app, child, "title") || child.basename;
              const author = getFrontmatterValueFromCache(this.app, child, "author") || "";
              bookNotes.push({ file: child, title, author });
            }
          } else {
            // No cache yet - collect for potential fallback check
            uncachedFiles.push(child);
          }
        } else if (child instanceof TFolder) {
          processFolder(child);
        }
      }
    };

    processFolder(booksFolder);
    
    // Fallback: if we found NO cached book notes but there are uncached files,
    // do a content-based check on uncached files (cold start scenario)
    if (bookNotes.length === 0 && uncachedFiles.length > 0) {
      console.log(`[Book Voice Capture] Cache miss: checking ${uncachedFiles.length} uncached files`);
      this.checkUncachedFilesForBooks(uncachedFiles, bookNotes);
    }
    
    // Sort by title
    bookNotes.sort((a, b) => a.title.localeCompare(b.title));
    
    return bookNotes;
  }

  /**
   * Synchronously check uncached files for book notes using content-based validation.
   * Only called as fallback when cache returns no results.
   * Uses cachedRead for better performance than full read.
   */
  private checkUncachedFilesForBooks(files: TFile[], bookNotes: BookNoteItem[]): void {
    for (const file of files) {
      try {
        // Use cachedRead which is faster than full read
        const content = (this.app.vault as any).cachedRead?.(file);
        if (content && typeof content === "string") {
          if (isBookNote(content)) {
            // Extract title and author from frontmatter via regex
            const title = this.extractFrontmatterValue(content, "title") || file.basename;
            const author = this.extractFrontmatterValue(content, "author") || "";
            bookNotes.push({ file, title, author });
          }
        }
      } catch {
        // Ignore errors - file will be available when cache populates
      }
    }
  }

  /**
   * Extract a frontmatter value from content using regex (fallback for uncached files)
   */
  private extractFrontmatterValue(content: string, key: string): string | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;
    
    const keyMatch = frontmatterMatch[1].match(new RegExp(`${key}:\\s*["']?([^"'\n]+)["']?`, "i"));
    return keyMatch ? keyMatch[1].trim() : null;
  }

  /**
   * Ensure a BookMeta object has a language code (ko/en) inferred from its metadata.
   */
  private ensureBookLanguage(meta: BookMeta): BookMeta {
    if (meta.language) {
      return { ...meta, language: this.normalizeLanguageCode(meta.language) ?? "en" };
    }

    const detectionSource = [meta.title, meta.author, meta.publisher, meta.description]
      .filter(Boolean)
      .join(" ");
    const hasHangul = /[가-힣]/.test(detectionSource);
    return { ...meta, language: hasHangul ? "ko" : "en" };
  }

  /**
   * Infer language from note content or frontmatter.
   */
  private inferLanguageFromContent(content: string): string {
    const frontmatterLanguage = this.normalizeLanguageCode(this.extractFrontmatterValue(content, "language"));
    if (frontmatterLanguage) {
      return frontmatterLanguage;
    }
    return /[가-힣]/.test(content) ? "ko" : "en";
  }

  private normalizeLanguageCode(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    if (normalized.startsWith("ko")) {
      return "ko";
    }
    if (normalized.startsWith("en")) {
      return "en";
    }
    return null;
  }

  private async ensureBaseFileExists(): Promise<void> {
    try {
      const baseFolder = this.getBaseFolderPath();
      if (!baseFolder) {
        return;
      }
      await ensureFolderExists(this.app, baseFolder);

      const baseFilePath = this.getBaseFileVaultPath();
      const baseFileDir = baseFilePath.split("/").slice(0, -1).join("/");
      if (baseFileDir && baseFileDir !== baseFolder) {
        await ensureFolderExists(this.app, baseFileDir);
      }

      const existing = this.app.vault.getAbstractFileByPath(baseFilePath);
      if (existing instanceof TFile) {
        return;
      }

      const content = this.buildDefaultBaseFileContent();
      await this.app.vault.create(baseFilePath, content);
      console.log(`[Book Voice Capture] Created base file at ${baseFilePath}`);
    } catch (error) {
      console.error("[Book Voice Capture] Failed to create base file:", error);
    }
  }

  private buildDefaultBaseFileContent(): string {
    const sourceFolder = this.getBookPagesFolder();
    const now = new Date().toISOString();
    const baseData = {
      version: 1,
      name: "Book Voice Capture",
      description: "Auto-generated base that lists every note created by the Book Voice Capture plugin.",
      icon: "book-open",
      source: {
        type: "folder",
        path: sourceFolder,
      },
      filter: {
        type: "property",
        property: "type",
        operator: "equals",
        value: "book",
      },
      views: [
        {
          id: "books-grid",
          type: "gallery",
          name: "Book Covers",
          card: {
            imageProperty: "Cover",
            titleProperty: "title",
            subtitleProperty: "author",
            descriptionProperty: "publisher",
          },
          filter: {
            type: "property",
            property: "Cover",
            operator: "is not empty",
          },
          sort: [
            { property: "title", direction: "asc" },
          ],
        },
        {
          id: "books-table",
          type: "table",
          name: "Books",
          columns: [
            { property: "title", label: "Title", width: 260 },
            { property: "author", label: "Author", width: 200 },
            { property: "publisher", label: "Publisher", width: 200 },
            { property: "status", label: "Status", width: 120 },
            { property: "language", label: "Language", width: 100 },
            { property: "rating", label: "Rating", width: 80 },
          ],
          sort: [
            { property: "title", direction: "asc" },
          ],
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    return JSON.stringify(baseData, null, 2);
  }

  /**
   * Show the action choice modal
   */
  private showActionModal(): void {
    const bookNotes = this.getBookNotes();
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
   * NOTE: API key is NOT checked here - allows book selection/opening.
   * API key is checked when recording actually starts.
   */
  private addVoiceNoteToExistingBook(): void {
    const bookNotes = this.getBookNotes();

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
   * Open a book note and start voice recording.
   * Uses workspace event instead of setTimeout for reliable editor access.
   */
  private async openBookAndStartRecording(file: TFile): Promise<void> {
    // Create a one-time event handler for when the file is opened
    const eventRef: EventRef = this.app.workspace.on("file-open", (openedFile: TFile | null) => {
      // Unregister immediately to prevent multiple triggers
      this.app.workspace.offref(eventRef);
      
      if (!openedFile || openedFile.path !== file.path) {
        return;
      }

      // Use onLayoutReady to ensure the editor is fully initialized
      this.app.workspace.onLayoutReady(() => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice("Failed to open book note");
          return;
        }

        const editor = view.editor;
        const content = editor.getValue();

        // Verify it's a book note (double-check with content)
        if (!isBookNote(content)) {
          new Notice("Selected file is not a valid book note");
          return;
        }

        // Move cursor to highlight section
        moveCursorToHighlightSection(editor);

        const language = this.inferLanguageFromContent(content);

        // Check API key only when recording is about to start
        if (!this.settings.openAIApiKey) {
          new Notice("Please set your OpenAI API key in settings to use voice recording.");
          return;
        }

        // Start recording
        new RecordingModal(
          this.app,
          async (audioBlob: Blob) => {
            await this.processVoiceRecording(audioBlob, editor, language);
          },
          () => {
            new Notice("Recording cancelled");
          }
        ).open();
      });
    });

    // Open the file
    await this.app.workspace.openLinkText(file.path, "", false);
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
   * Process book search and create/open note.
   * NEW: Shows multiple candidates for user selection, then starts voice flow.
   * NOTE: API key is NOT required for note creation - only checked when recording starts.
   */
  private async processBookSearch(query: string): Promise<void> {
    new Notice(`Searching for "${query}"...`);

    if (!this.settings.kyoboEnabled) {
      // Kyobo disabled, create note with query as title and start recording
      const meta: BookMeta = { title: query, author: "" };
      await this.createBookNoteAndStartRecording(meta);
      return;
    }

    try {
      // Fetch search candidates
      const candidates = await fetchKyoboSearchCandidates(query);

      if (candidates.length === 0) {
        // No results - use query as title
        new Notice("No books found on Kyobo, creating note with title only");
        const meta: BookMeta = { title: query, author: "" };
        await this.createBookNoteAndStartRecording(meta);
        return;
      }

      if (candidates.length === 1) {
        // Single result - use it directly
        new Notice(`Found: ${candidates[0].title}`);
        await this.processSelectedCandidate(candidates[0]);
        return;
      }

      // Multiple results - show selection modal
      new Notice(`Found ${candidates.length} books. Please select one.`);
      new KyoboCandidateModal(
        this.app,
        candidates,
        async (candidate: KyoboSearchCandidate) => {
          await this.processSelectedCandidate(candidate);
        }
      ).open();

    } catch (error) {
      console.error("[Book Voice Capture] Kyobo search error:", error);
      new Notice("Kyobo search failed, creating note with title only");
      const meta: BookMeta = { title: query, author: "" };
      await this.createBookNoteAndStartRecording(meta);
    }
  }

  /**
   * Process a selected Kyobo candidate: fetch full metadata, create note, start recording
   */
  private async processSelectedCandidate(candidate: KyoboSearchCandidate): Promise<void> {
    new Notice(`Loading details for "${candidate.title}"...`);

    try {
      // Fetch full metadata from detail page
      const meta = await fetchKyoboDetailMeta(candidate.detailUrl);

      if (meta) {
        await this.createBookNoteAndStartRecording(meta);
      } else {
        // Use candidate info as fallback
        const fallbackMeta: BookMeta = {
          title: candidate.title,
          author: candidate.author,
          publisher: candidate.publisher,
          publishedDate: candidate.publishedYear,
          isbn: candidate.isbn,
          kyoboUrl: candidate.detailUrl,
        };
        await this.createBookNoteAndStartRecording(fallbackMeta);
      }
    } catch (error) {
      console.error("[Book Voice Capture] Error fetching detail:", error);
      // Use candidate info as fallback
      const fallbackMeta: BookMeta = {
        title: candidate.title,
        author: candidate.author,
        publisher: candidate.publisher,
        publishedDate: candidate.publishedYear,
        isbn: candidate.isbn,
        kyoboUrl: candidate.detailUrl,
      };
      await this.createBookNoteAndStartRecording(fallbackMeta);
    }
  }

  /**
   * Create or open a book note, insert clipping placeholder, and start recording.
   * This is the unified flow for the Kyobo search command.
   */
  private async createBookNoteAndStartRecording(meta: BookMeta): Promise<void> {
    await this.ensureBaseFileExists();
    const resolvedMeta = this.ensureBookLanguage(meta);
    const notePath = getBookNotePath(this.getBookPagesFolder(), resolvedMeta.title);
    const existingFile = this.app.vault.getAbstractFileByPath(notePath);

    if (existingFile instanceof TFile) {
      // File exists - open, insert placeholder, and start recording
      await this.openBookInsertPlaceholderAndRecord(existingFile);
    } else {
      // Create new file, insert placeholder, and start recording
      await this.createBookNoteInsertPlaceholderAndRecord(resolvedMeta);
    }
  }

  /**
   * Open an existing book note, insert clipping placeholder, and start recording
   */
  private async openBookInsertPlaceholderAndRecord(file: TFile): Promise<void> {
    const eventRef: EventRef = this.app.workspace.on("file-open", (openedFile: TFile | null) => {
      this.app.workspace.offref(eventRef);
      
      if (!openedFile || openedFile.path !== file.path) {
        return;
      }

      this.app.workspace.onLayoutReady(() => {
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

        // Insert clipping placeholder
        const placeholder = createClippingPlaceholder();
        insertHighlightBlock(editor, placeholder, "## 인상 깊은 문장 & 메모 (Voice)");

        // Move cursor to highlight section
        moveCursorToHighlightSection(editor);

        const language = this.inferLanguageFromContent(content);

        // Start recording
        this.startRecordingWithPlaceholder(editor, language);
      });
    });

    await this.app.workspace.openLinkText(file.path, "", false);
    new Notice(`Opened existing note, ready to record`);
  }

  /**
   * Create a new book note, optionally generate GPT summary, insert placeholder, and start recording.
   * GPT summary is generated asynchronously (non-blocking) so note creation isn't delayed.
   */
  private async createBookNoteInsertPlaceholderAndRecord(meta: BookMeta): Promise<void> {
    try {
      const resolvedMeta = this.ensureBookLanguage(meta);
      // Ensure the books folder exists
      await ensureFolderExists(this.app, this.getBookPagesFolder());

      // Render the template (without GPT - we'll add it async)
      const content = renderBookNoteTemplate(this.settings.bookNoteTemplate, resolvedMeta);

      // Create the file immediately (don't wait for GPT)
      const notePath = getBookNotePath(this.getBookPagesFolder(), resolvedMeta.title);
      const newFile = await this.app.vault.create(notePath, content);

      // Start GPT generation in background if enabled (non-blocking)
      const shouldGenerateGpt = this.settings.enableGptSummary && this.settings.openAIApiKey;
      if (shouldGenerateGpt) {
        // Fire and forget - don't await
        this.generateGptSummaryAsync(newFile, resolvedMeta);
      }

      // Open and set up recording (happens immediately, doesn't wait for GPT)
      const eventRef: EventRef = this.app.workspace.on("file-open", (openedFile: TFile | null) => {
        this.app.workspace.offref(eventRef);
        
        if (!openedFile || openedFile.path !== newFile.path) {
          return;
        }

        this.app.workspace.onLayoutReady(() => {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (!view) {
            new Notice("Failed to open new book note");
            return;
          }

          const editor = view.editor;

          // Insert clipping placeholder
          const placeholder = createClippingPlaceholder();
          insertHighlightBlock(editor, placeholder, "## 인상 깊은 문장 & 메모 (Voice)");

          // Move cursor to highlight section
          moveCursorToHighlightSection(editor);

          // Start recording
          this.startRecordingWithPlaceholder(editor, resolvedMeta.language);
        });
      });

      await this.app.workspace.openLinkText(notePath, "", false);
      new Notice(`Created book note: ${resolvedMeta.title}`);

    } catch (error) {
      console.error("[Book Voice Capture] Failed to create book note:", error);
      new Notice("Failed to create book note. Check console for details.");
    }
  }

  /**
   * Generate GPT summary asynchronously and append to file when ready.
   * This runs in the background without blocking note creation or recording.
   * Uses a timeout to prevent indefinite waits.
   */
  private async generateGptSummaryAsync(file: TFile, meta: BookMeta): Promise<void> {
    const GPT_TIMEOUT_MS = 30000; // 30 second timeout
    
    new Notice("Generating GPT summary in background...");
    
    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("GPT request timed out")), GPT_TIMEOUT_MS);
      });
      
      // Race between GPT call and timeout
      const gptResult = await Promise.race([
        generateGptSummary(
          meta,
          this.settings.openAIApiKey,
          this.settings.gptSummaryModel,
          this.settings.gptMaxTokens,
          this.settings.gptTemperature
        ),
        timeoutPromise,
      ]);
      
      // Read current file content
      const currentContent = await this.app.vault.read(file);
      
      // Check if GPT section already exists (user may have added manually)
      if (hasGptSummarySection(currentContent)) {
        console.log("[Book Voice Capture] GPT section already exists, skipping async insert");
        return;
      }
      
      let updatedContent: string;
      
      if (!gptResult.success || !gptResult.content) {
        const errorMsg = gptResult.errorMessage || "Unknown error";
        new Notice(`GPT summary failed: ${errorMsg}`);
        const failureSection = formatGptSummaryUnavailable(errorMsg);
        updatedContent = insertGptSummaryIntoContent(currentContent, failureSection);
      } else {
        const gptSection = formatGptSummarySection(gptResult.content);
        updatedContent = insertGptSummaryIntoContent(currentContent, gptSection);
        new Notice("GPT summary added!");
      }
      
      // Update the file
      await this.app.vault.modify(file, updatedContent);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[Book Voice Capture] Async GPT generation failed:", error);
      new Notice(`GPT summary failed: ${errorMsg}`);
      
      // Try to add failure status to file
      try {
        const currentContent = await this.app.vault.read(file);
        if (!hasGptSummarySection(currentContent)) {
          const failureSection = formatGptSummaryUnavailable(errorMsg);
          const updatedContent = insertGptSummaryIntoContent(currentContent, failureSection);
          await this.app.vault.modify(file, updatedContent);
        }
      } catch {
        // Ignore errors updating file with failure status
      }
    }
  }

  /**
   * Start recording with placeholder replacement logic.
   * After transcription, the highlight replaces the placeholder marker.
   * API key is checked here (not earlier) to allow note creation without a key.
   */
  private startRecordingWithPlaceholder(editor: Editor, language?: string): void {
    // Check API key only when recording is about to start
    if (!this.settings.openAIApiKey) {
      new Notice("Please set your OpenAI API key in settings to use voice recording.");
      // Remove the placeholder since we can't record
      this.removePlaceholder(editor);
      return;
    }

    const targetLanguage = language || this.inferLanguageFromContent(editor.getValue());

    new RecordingModal(
      this.app,
      async (audioBlob: Blob) => {
        await this.processVoiceRecordingWithPlaceholder(audioBlob, editor, targetLanguage);
      },
      () => {
        // Recording cancelled - remove placeholder
        this.removePlaceholder(editor);
        new Notice("Recording cancelled");
      }
    ).open();
  }

  /**
   * Process voice recording and replace the placeholder with actual highlight
   */
  private async processVoiceRecordingWithPlaceholder(
    audioBlob: Blob,
    editor: Editor,
    language?: string
  ): Promise<void> {
    new Notice("Transcribing audio...");

    try {
      // Transcribe the audio
      const transcribedText = await transcribeAudio(
        audioBlob,
        this.settings.openAIApiKey,
        this.settings.openAIWhisperModel,
        language
      );

      if (!transcribedText) {
        new Notice("Transcription returned empty result");
        // Keep placeholder but update it to show empty result
        return;
      }

      // Show truncated preview
      const preview = transcribedText.length > 50 
        ? transcribedText.substring(0, 50) + "..." 
        : transcribedText;
      new Notice(`Transcribed: "${preview}"`);

      // Parse the transcription
      const parsed = parseTranscription(transcribedText);

      // Render the highlight block
      const highlightBlock = renderHighlightTemplate(
        this.settings.highlightBlockTemplate,
        parsed
      );

      // Replace placeholder with actual highlight
      this.replacePlaceholderWithHighlight(editor, highlightBlock);

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

  /**
   * Replace the clipping placeholder with the actual highlight block.
   * Uses consolidated helper from util.ts for consistent behavior.
   */
  private replacePlaceholderWithHighlight(editor: Editor, highlightBlock: string): void {
    replacePlaceholder(editor, highlightBlock, "## 인상 깊은 문장 & 메모 (Voice)");
  }

  /**
   * Remove the clipping placeholder (e.g., when recording is cancelled).
   * Uses consolidated helper from util.ts for consistent behavior.
   */
  private removePlaceholder(editor: Editor): void {
    removePlaceholderBlock(editor);
  }

  /**
   * Command handler: Add Voice Highlight (current note).
   * Uses metadataCache when file is available for consistent behavior.
   */
  private addVoiceHighlight(editor: Editor, view: MarkdownView): void {
    // Check API key
    if (!this.settings.openAIApiKey) {
      new Notice("Please set your OpenAI API key in Book Voice Capture settings.");
      return;
    }

    // Check if current file is a book note
    const file = view.file;
    let isBook = false;
    const content = editor.getValue();
    
    if (file) {
      isBook = isBookNoteFromCache(this.app, file);
    }
    
    // Fallback to content-based check
    if (!isBook) {
      isBook = isBookNote(content);
    }
    
    if (!isBook) {
      new Notice("Active note is not a book note (missing 'type: book' in frontmatter).");
      return;
    }

    const language = this.inferLanguageFromContent(content);

    // Start recording
    new RecordingModal(
      this.app,
      async (audioBlob: Blob) => {
        await this.processVoiceRecording(audioBlob, editor, language);
      },
      () => {
        new Notice("Recording cancelled");
      }
    ).open();
  }

  /**
   * Process voice recording: transcribe and insert highlight (without placeholder).
   */
  private async processVoiceRecording(
    audioBlob: Blob,
    editor: Editor,
    language?: string
  ): Promise<void> {
    new Notice("Transcribing audio...");

    try {
      // Transcribe the audio
      const transcribedText = await transcribeAudio(
        audioBlob,
        this.settings.openAIApiKey,
        this.settings.openAIWhisperModel,
        language
      );

      if (!transcribedText) {
        new Notice("Transcription returned empty result");
        return;
      }

      // Show truncated preview
      const preview = transcribedText.length > 50 
        ? transcribedText.substring(0, 50) + "..." 
        : transcribedText;
      new Notice(`Transcribed: "${preview}"`);

      // Parse the transcription
      const parsed = parseTranscription(transcribedText);

      // Render the highlight block
      const highlightBlock = renderHighlightTemplate(
        this.settings.highlightBlockTemplate,
        parsed
      );

      // Insert using fresh content
      insertHighlightBlock(
        editor,
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
