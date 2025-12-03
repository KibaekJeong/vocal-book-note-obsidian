import { Modal, App, Notice, requestUrl } from "obsidian";
import { TranscriptionResult } from "./voice";

/**
 * Result from OCR extraction
 */
export interface OcrResult {
  success: boolean;
  text: string | null;
  errorMessage: string | null;
}

/**
 * Modal for capturing quotes from photos
 * Allows image upload/capture, OCR extraction, and sentence selection
 */
export class PhotoQuoteModal extends Modal {
  private fileInput: HTMLInputElement | null = null;
  private pageInput: HTMLInputElement | null = null;
  private extractBtn: HTMLButtonElement | null = null;
  private addQuoteBtn: HTMLButtonElement | null = null;
  private sentencesContainer: HTMLDivElement | null = null;
  private statusEl: HTMLElement | null = null;
  private selectedFile: File | null = null;
  private sentences: string[] = [];
  private selectedIndices: Set<number> = new Set();
  private rawText: string = "";
  
  private apiKey: string;
  private model: string;
  private onComplete: (result: TranscriptionResult) => void;
  private onCancel: () => void;

  constructor(
    app: App,
    apiKey: string,
    model: string,
    onComplete: (result: TranscriptionResult) => void,
    onCancel: () => void
  ) {
    super(app);
    this.apiKey = apiKey;
    this.model = model;
    this.onComplete = onComplete;
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("book-voice-capture-photo-modal");

    // Title
    contentEl.createEl("h3", { text: "Add Quote from Photo" });

    // Instructions
    contentEl.createEl("p", { 
      text: "Take a photo or select an image to extract text from.",
      cls: "book-voice-capture-instructions"
    });

    // File input section
    const inputSection = contentEl.createDiv({ cls: "book-voice-capture-photo-input-section" });
    
    // File input with camera capture support for mobile
    this.fileInput = inputSection.createEl("input", {
      type: "file",
      attr: { 
        accept: "image/*",
        capture: "environment"
      }
    });
    this.fileInput.style.marginBottom = "12px";
    
    this.fileInput.addEventListener("change", () => {
      if (this.fileInput?.files && this.fileInput.files.length > 0) {
        this.selectedFile = this.fileInput.files[0];
        if (this.extractBtn) {
          this.extractBtn.disabled = false;
        }
        this.updateStatus(`Selected: ${this.selectedFile.name}`);
      }
    });

    // Page number input
    const pageSection = inputSection.createDiv({ cls: "book-voice-capture-page-section" });
    pageSection.style.marginBottom = "12px";
    pageSection.style.display = "flex";
    pageSection.style.alignItems = "center";
    pageSection.style.gap = "8px";
    
    pageSection.createEl("label", { text: "Page:" });
    this.pageInput = pageSection.createEl("input", {
      type: "text",
      placeholder: "e.g., 42",
      attr: { style: "width: 80px; padding: 4px 8px;" }
    });

    // Status display
    this.statusEl = contentEl.createDiv({ cls: "book-voice-capture-status" });
    this.statusEl.style.marginBottom = "12px";
    this.statusEl.style.color = "var(--text-muted)";
    this.statusEl.style.fontSize = "0.9em";

    // Sentences container (hidden initially)
    this.sentencesContainer = contentEl.createDiv({ cls: "book-voice-capture-sentences" });
    this.sentencesContainer.style.display = "none";
    this.sentencesContainer.style.maxHeight = "300px";
    this.sentencesContainer.style.overflowY = "auto";
    this.sentencesContainer.style.marginBottom = "12px";
    this.sentencesContainer.style.border = "1px solid var(--background-modifier-border)";
    this.sentencesContainer.style.borderRadius = "4px";
    this.sentencesContainer.style.padding = "8px";

    // Buttons
    const buttonsEl = contentEl.createDiv({ cls: "book-voice-capture-buttons" });
    buttonsEl.style.display = "flex";
    buttonsEl.style.gap = "8px";
    buttonsEl.style.flexWrap = "wrap";

    // Extract Text button
    this.extractBtn = buttonsEl.createEl("button", { 
      text: "Extract Text",
      cls: "mod-cta"
    });
    this.extractBtn.disabled = true;
    this.extractBtn.onclick = () => this.extractText();

    // Add Selected Quotes button (hidden initially)
    this.addQuoteBtn = buttonsEl.createEl("button", { 
      text: "Add Selected Quotes",
      cls: "mod-cta"
    });
    this.addQuoteBtn.style.display = "none";
    this.addQuoteBtn.disabled = true;
    this.addQuoteBtn.onclick = () => this.addSelectedQuotes();

    // Cancel button
    const cancelBtn = buttonsEl.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => {
      this.close();
      this.onCancel();
    };
  }

  private updateStatus(message: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = message;
    }
  }

  private async extractText(): Promise<void> {
    if (!this.selectedFile) {
      new Notice("Please select an image first");
      return;
    }

    // Disable button and show loading
    if (this.extractBtn) {
      this.extractBtn.disabled = true;
      this.extractBtn.textContent = "Extracting...";
    }
    this.updateStatus("Extracting text from image...");

    try {
      const result = await extractTextFromImage(this.selectedFile, this.apiKey, this.model);

      if (!result.success || !result.text) {
        new Notice(`OCR failed: ${result.errorMessage || "Unknown error"}`);
        this.updateStatus(`Error: ${result.errorMessage || "Failed to extract text"}`);
        this.resetExtractButton();
        return;
      }

      this.rawText = result.text;
      this.sentences = splitTextIntoSentences(result.text);

      if (this.sentences.length === 0) {
        // No sentences found, show raw text as fallback
        this.showFallbackTextarea();
      } else {
        // Show sentence selection UI
        this.showSentenceSelection();
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      new Notice(`OCR failed: ${errorMsg}`);
      this.updateStatus(`Error: ${errorMsg}`);
      this.resetExtractButton();
    }
  }

  private resetExtractButton(): void {
    if (this.extractBtn) {
      this.extractBtn.disabled = false;
      this.extractBtn.textContent = "Extract Text";
    }
  }

  private showSentenceSelection(): void {
    if (!this.sentencesContainer) return;

    this.sentencesContainer.empty();
    this.sentencesContainer.style.display = "block";
    this.selectedIndices.clear();

    // Instructions
    const instructionEl = this.sentencesContainer.createDiv();
    instructionEl.style.marginBottom = "8px";
    instructionEl.style.color = "var(--text-muted)";
    instructionEl.style.fontSize = "0.85em";
    instructionEl.textContent = "Click sentences to select them:";

    // Create sentence buttons
    for (let sentenceIndex = 0; sentenceIndex < this.sentences.length; sentenceIndex++) {
      const sentence = this.sentences[sentenceIndex];
      const sentenceBtn = this.sentencesContainer.createEl("button", {
        cls: "book-voice-capture-sentence-btn"
      });
      sentenceBtn.textContent = sentence;
      sentenceBtn.style.display = "block";
      sentenceBtn.style.width = "100%";
      sentenceBtn.style.textAlign = "left";
      sentenceBtn.style.padding = "8px";
      sentenceBtn.style.marginBottom = "4px";
      sentenceBtn.style.border = "1px solid var(--background-modifier-border)";
      sentenceBtn.style.borderRadius = "4px";
      sentenceBtn.style.background = "var(--background-primary)";
      sentenceBtn.style.cursor = "pointer";
      sentenceBtn.style.whiteSpace = "normal";
      sentenceBtn.style.wordWrap = "break-word";

      const currentIndex = sentenceIndex;
      sentenceBtn.onclick = () => {
        if (this.selectedIndices.has(currentIndex)) {
          this.selectedIndices.delete(currentIndex);
          sentenceBtn.style.background = "var(--background-primary)";
          sentenceBtn.style.borderColor = "var(--background-modifier-border)";
        } else {
          this.selectedIndices.add(currentIndex);
          sentenceBtn.style.background = "var(--interactive-accent)";
          sentenceBtn.style.borderColor = "var(--interactive-accent)";
          sentenceBtn.style.color = "var(--text-on-accent)";
        }
        this.updateAddButtonState();
      };
    }

    // Show the add button
    if (this.addQuoteBtn) {
      this.addQuoteBtn.style.display = "inline-block";
    }
    
    // Hide extract button
    if (this.extractBtn) {
      this.extractBtn.style.display = "none";
    }

    this.updateStatus(`Found ${this.sentences.length} sentence(s). Select the ones you want to add.`);
  }

  private showFallbackTextarea(): void {
    if (!this.sentencesContainer) return;

    this.sentencesContainer.empty();
    this.sentencesContainer.style.display = "block";

    // Show raw text in a textarea for manual selection
    const instructionEl = this.sentencesContainer.createDiv();
    instructionEl.style.marginBottom = "8px";
    instructionEl.style.color = "var(--text-muted)";
    instructionEl.textContent = "No distinct sentences found. You can use all text as a quote:";

    const textArea = this.sentencesContainer.createEl("textarea");
    textArea.value = this.rawText;
    textArea.style.width = "100%";
    textArea.style.minHeight = "100px";
    textArea.style.padding = "8px";
    textArea.style.marginBottom = "8px";

    const useAllBtn = this.sentencesContainer.createEl("button", {
      text: "Use All Text as Quote",
      cls: "mod-cta"
    });
    useAllBtn.onclick = () => {
      // Use the textarea content (in case user edited it)
      const text = textArea.value.trim();
      if (!text) {
        new Notice("No text to add");
        return;
      }
      this.addQuoteWithText(text);
    };

    // Hide extract button
    if (this.extractBtn) {
      this.extractBtn.style.display = "none";
    }

    this.updateStatus("Edit the text above if needed, then click the button to add it.");
  }

  private updateAddButtonState(): void {
    if (this.addQuoteBtn) {
      this.addQuoteBtn.disabled = this.selectedIndices.size === 0;
    }
  }

  private addSelectedQuotes(): void {
    if (this.selectedIndices.size === 0) {
      new Notice("Please select at least one sentence");
      return;
    }

    // Combine selected sentences in order
    const selectedSentences: string[] = [];
    const sortedIndices = Array.from(this.selectedIndices).sort((a, b) => a - b);
    for (const sentenceIndex of sortedIndices) {
      selectedSentences.push(this.sentences[sentenceIndex]);
    }

    const combinedText = selectedSentences.join(" ");
    this.addQuoteWithText(combinedText);
  }

  private addQuoteWithText(text: string): void {
    const page = this.pageInput?.value.trim() || "?";

    const result: TranscriptionResult = {
      text: text,
      page: page,
      quote: "",
      note: text,
    };

    this.close();
    this.onComplete(result);
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Extract text from an image using OpenAI Vision API
 */
export async function extractTextFromImage(
  imageFile: File,
  apiKey: string,
  model: string = "gpt-4o-mini"
): Promise<OcrResult> {
  if (!apiKey) {
    return { success: false, text: null, errorMessage: "No API key configured" };
  }

  try {
    // Convert image to base64 data URL
    const base64Data = await fileToBase64(imageFile);
    const mimeType = imageFile.type || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    console.log(`[Book Voice Capture] Extracting text from image: ${imageFile.name}`);

    const response = await requestUrl({
      url: "https://api.openai.com/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "system",
            content: "You are an OCR assistant. Extract and return ONLY the text visible in the image. Do not add any commentary, explanation, or formatting. Just return the raw text exactly as it appears, preserving paragraph breaks where visible.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all text from this image:",
              },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 4000,
        temperature: 0,
      }),
      throw: false,
    });

    if (response.status !== 200) {
      let errorMessage = `API error (${response.status})`;
      try {
        const errorBody = JSON.parse(response.text);
        errorMessage = errorBody?.error?.message || errorMessage;
      } catch {
        if (response.text.length < 200) {
          errorMessage = response.text;
        }
      }
      console.error(`[Book Voice Capture] OCR API error: ${response.status}`, response.text);
      return { success: false, text: null, errorMessage };
    }

    const data = response.json;
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return { success: false, text: null, errorMessage: "Empty response from API" };
    }

    console.log(`[Book Voice Capture] OCR completed: ${content.length} chars`);
    return { success: true, text: content.trim(), errorMessage: null };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Book Voice Capture] OCR failed:", error);
    return { success: false, text: null, errorMessage: errorMsg };
  }
}

/**
 * Convert a File to base64 string
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix to get just the base64 data
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Split text into sentences for selection
 * Handles both English and Korean punctuation
 */
export function splitTextIntoSentences(text: string): string[] {
  // Normalize whitespace
  const normalized = text.replace(/\s+/g, " ").trim();
  
  if (!normalized) {
    return [];
  }

  // Split on sentence-ending punctuation followed by space or end of string
  // Handles: . ? ! and their combinations, including Korean usage
  // Also handles cases like "..." or "?!" 
  const sentencePattern = /[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g;
  const matches = normalized.match(sentencePattern);
  
  if (!matches) {
    // No sentence pattern found, return the whole text as one item
    return [normalized];
  }

  // Clean up and filter sentences
  const sentences: string[] = [];
  for (const match of matches) {
    const trimmed = match.trim();
    // Filter out very short fragments (less than 5 characters)
    if (trimmed.length >= 5) {
      sentences.push(trimmed);
    }
  }

  // If no valid sentences after filtering, return the original text
  if (sentences.length === 0) {
    return [normalized];
  }

  return sentences;
}

