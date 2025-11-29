import { Modal, App, Notice, requestUrl } from "obsidian";

export interface TranscriptionResult {
  text: string;
  page: string;
  quote: string;
  note: string;
}

/**
 * Recording Modal that shows recording status and allows stopping
 */
export class RecordingModal extends Modal {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private timerInterval: number | null = null;
  private startTime: number = 0;
  private timerEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private uploadBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private onComplete: (blob: Blob) => Promise<void> | void;
  private onCancel: () => void;
  private recordingDot: HTMLElement | null = null;

  constructor(
    app: App,
    onComplete: (blob: Blob) => Promise<void> | void,
    onCancel: () => void
  ) {
    super(app);
    this.onComplete = onComplete;
    this.onCancel = onCancel;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("book-voice-capture-recording-modal");

    // Title
    contentEl.createEl("h3", { text: "Voice Highlight Recording" });

    // Recording indicator
    const indicatorEl = contentEl.createDiv({ cls: "book-voice-capture-recording-indicator" });
    this.recordingDot = indicatorEl.createDiv({ cls: "book-voice-capture-recording-dot" });
    // Initially inactive
    this.recordingDot.removeClass("active");
    
    this.statusEl = indicatorEl.createSpan({ text: "Ready to record" });

    // Timer
    this.timerEl = contentEl.createDiv({ cls: "book-voice-capture-timer", text: "00:00" });

    // Instructions
    contentEl.createEl("p", { 
      text: 'Speak in format: "페이지 [number]. 인용문: [quote]. 메모: [note]"',
      cls: "book-voice-capture-instructions"
    });

    // Hidden file input for upload
    const fileInput = contentEl.createEl("input", {
      type: "file",
      attr: { 
        accept: "audio/*,.mp3,.m4a,.wav,.ogg,.webm",
        style: "display: none;"
      }
    });
    
    fileInput.addEventListener("change", async () => {
      if (fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        
        // Show processing state
        this.setProcessingState();
        
        try {
          await this.onComplete(file);
        } catch (e) {
          console.error(e);
          new Notice("Processing failed");
        }
        
        // Reset UI for next action
        fileInput.value = ""; // Clear input
        this.resetToReadyState();
      }
    });

    // Buttons
    const buttonsEl = contentEl.createDiv({ cls: "book-voice-capture-buttons" });
    
    // Start Button
    this.startBtn = buttonsEl.createEl("button", { 
      text: "Start Recording",
      cls: "book-voice-capture-start-btn"
    });
    this.startBtn.onclick = (): void => {
      this.initiateRecording();
    };

    // Upload Button
    this.uploadBtn = buttonsEl.createEl("button", { 
      text: "Upload File",
      cls: "book-voice-capture-upload-btn"
    });
    this.uploadBtn.onclick = (): void => {
      fileInput.click();
    };

    // Stop Button (Hidden initially)
    this.stopBtn = buttonsEl.createEl("button", { 
      text: "Stop & Transcribe",
      cls: "book-voice-capture-stop-btn"
    });
    this.stopBtn.style.display = "none";
    this.stopBtn.onclick = (): void => this.stopRecording();

    // Cancel Button
    const cancelBtn = buttonsEl.createEl("button", { 
      text: "Cancel",
      cls: "book-voice-capture-cancel-btn"
    });
    cancelBtn.onclick = (): void => this.cancelRecording();
  }

  private async initiateRecording(): Promise<void> {
    // Update UI state
    if (this.startBtn) this.startBtn.style.display = "none";
    if (this.uploadBtn) this.uploadBtn.style.display = "none";
    if (this.stopBtn) this.stopBtn.style.display = "inline-block"; // or block/flex depending on css
    if (this.statusEl) this.statusEl.textContent = "Recording...";
    if (this.recordingDot) this.recordingDot.addClass("active");
    
    await this.startRecording();
  }

  private async startRecording(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Determine the best supported audio format
      const mimeType = this.getSupportedMimeType();
      
      const options: MediaRecorderOptions = {};
      if (mimeType) {
        options.mimeType = mimeType;
      }

      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event: BlobEvent): void => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async (): Promise<void> => {
        const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        this.cleanup();
        
        try {
          await this.onComplete(audioBlob);
        } catch (e) {
          console.error(e);
          new Notice("Processing failed");
        }
        
        this.resetToReadyState();
      };

      this.mediaRecorder.onerror = (): void => {
        console.error("[Book Voice Capture] MediaRecorder error");
        new Notice("Recording error occurred");
        this.cancelRecording();
      };

      this.mediaRecorder.start(1000); // Collect data every second
      this.startTime = Date.now();
      this.startTimer();

    } catch (error) {
      console.error("[Book Voice Capture] Failed to start recording:", error);
      new Notice("Failed to access microphone. Please check permissions.");
      this.close();
      this.onCancel();
    }
  }

  private getSupportedMimeType(): string | null {
    const mimeTypes = [
      "audio/mp4", // Preferred for iOS/Safari
      "audio/webm;codecs=opus", // Preferred for Chrome/Firefox/Android
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mpeg",
    ];

    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    }
    return null;
  }

  private startTimer(): void {
    this.timerInterval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60).toString().padStart(2, "0");
      const seconds = (elapsed % 60).toString().padStart(2, "0");
      if (this.timerEl) {
        this.timerEl.textContent = `${minutes}:${seconds}`;
      }
    }, 1000);
  }

  private setProcessingState(): void {
    if (this.startBtn) this.startBtn.style.display = "none";
    if (this.uploadBtn) this.uploadBtn.style.display = "none";
    
    // Show stop button in disabled "Processing" state if not already visible
    if (this.stopBtn) {
      this.stopBtn.style.display = "inline-block";
      this.stopBtn.disabled = true;
      this.stopBtn.textContent = "Processing...";
    }
    
    if (this.statusEl) this.statusEl.textContent = "Transcribing...";
    if (this.recordingDot) this.recordingDot.removeClass("active");
  }

  private resetToReadyState(): void {
    if (this.startBtn) this.startBtn.style.display = "inline-block";
    if (this.uploadBtn) this.uploadBtn.style.display = "inline-block";
    
    if (this.stopBtn) {
      this.stopBtn.style.display = "none";
      this.stopBtn.disabled = false;
      this.stopBtn.textContent = "Stop & Transcribe";
    }
    
    if (this.statusEl) this.statusEl.textContent = "Ready to record";
    if (this.timerEl) this.timerEl.textContent = "00:00";
    if (this.recordingDot) this.recordingDot.removeClass("active");
  }

  private stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.setProcessingState();
      this.mediaRecorder.stop();
    }
  }

  private cancelRecording(): void {
    this.cleanup();
    this.close();
    this.onCancel();
  }

  private cleanup(): void {
    if (this.timerInterval) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  onClose(): void {
    this.cleanup();
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Modal for uploading an existing audio file for transcription
 */
export class AudioFileModal extends Modal {
  private onComplete: (file: File) => void;
  private onCancel: () => void;

  constructor(
    app: App,
    onComplete: (file: File) => void,
    onCancel: () => void
  ) {
    super(app);
    this.onComplete = onComplete;
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("book-voice-capture-upload-modal");

    contentEl.createEl("h3", { text: "Import Audio File" });
    contentEl.createEl("p", { text: "Select an audio file (mp3, m4a, wav, ogg, webm) to transcribe." });

    const container = contentEl.createDiv({ cls: "book-voice-capture-upload-container" });
    
    // File input
    const fileInput = container.createEl("input", { 
      type: "file",
      attr: { 
        accept: "audio/*,.mp3,.m4a,.wav,.ogg,.webm" 
      }
    });

    // Buttons container
    const buttonsEl = container.createDiv({ cls: "book-voice-capture-buttons" });
    buttonsEl.style.marginTop = "16px";

    // Transcribe Button
    const submitBtn = buttonsEl.createEl("button", { 
      text: "Transcribe",
      cls: "mod-cta"
    });
    submitBtn.disabled = true;
    
    // Cancel Button
    const cancelBtn = buttonsEl.createEl("button", { 
      text: "Cancel",
      cls: "book-voice-capture-cancel-btn"
    });
    cancelBtn.onclick = () => {
      this.close();
      this.onCancel();
    };

    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        submitBtn.disabled = false;
      } else {
        submitBtn.disabled = true;
      }
    });

    submitBtn.onclick = () => {
      if (fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        this.close();
        this.onComplete(file);
      }
    };
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Transcribe audio blob using OpenAI Whisper API.
 * CRITICAL FIX: Uses requestUrl with multipart body for mobile/CORS compatibility.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  model: string = "whisper-1",
  language?: string
): Promise<string> {
  try {
    // Convert blob to ArrayBuffer
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    // Determine file extension based on mime type
    const mimeType = audioBlob.type || "audio/webm";
    const extension = getExtensionFromMimeType(mimeType);
    const filename = `recording.${extension}`;
    
    // Build multipart form data manually for requestUrl compatibility
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    
    // Create the multipart body
    const bodyParts: (string | ArrayBuffer)[] = [];
    
    // Add file field
    bodyParts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    );
    bodyParts.push(arrayBuffer);
    bodyParts.push("\r\n");
    
    // Add model field
    bodyParts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `${model}\r\n`
    );
    
    if (language && language !== "auto") {
      bodyParts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\n` +
        `${language}\r\n`
      );
    }
    
    // Add response_format field
    bodyParts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `text\r\n`
    );
    
    // End boundary
    bodyParts.push(`--${boundary}--\r\n`);
    
    // Combine all parts into a single ArrayBuffer
    const body = await combineMultipartBody(bodyParts);
    
    // Make the request using Obsidian's requestUrl (works on mobile)
    const response = await requestUrl({
      url: "https://api.openai.com/v1/audio/transcriptions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
      throw: false, // Don't throw on non-2xx, we'll handle it
    });

    if (response.status !== 200) {
      // IMPORTANT FIX: Surface the error body for actionable feedback
      let errorDetail = "";
      try {
        // Try to parse as JSON for structured error
        const errorBody = JSON.parse(response.text);
        errorDetail = errorBody.error?.message || errorBody.message || response.text;
      } catch {
        // If not JSON, use the raw text (truncated for safety)
        errorDetail = response.text.substring(0, 200);
      }
      console.error("[Book Voice Capture] Whisper API error:", response.status, errorDetail);
      throw new Error(`Whisper API error (${response.status}): ${errorDetail}`);
    }

    const transcription = response.text.trim();
    
    // Don't log full transcription to avoid leaking user content
    console.log("[Book Voice Capture] Transcription completed, length:", transcription.length);
    
    return transcription;

  } catch (error) {
    console.error("[Book Voice Capture] Transcription failed:", error);
    throw error;
  }
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/webm": "webm",
    "audio/webm;codecs=opus": "webm",
    "audio/ogg": "ogg",
    "audio/ogg;codecs=opus": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
  };
  return mimeToExt[mimeType] || "webm";
}

/**
 * Combine multipart body parts into a single ArrayBuffer
 */
async function combineMultipartBody(parts: (string | ArrayBuffer)[]): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const buffers: ArrayBuffer[] = [];
  
  for (const part of parts) {
    if (typeof part === "string") {
      buffers.push(encoder.encode(part).buffer);
    } else {
      buffers.push(part);
    }
  }
  
  // Calculate total length
  let totalLength = 0;
  for (const buf of buffers) {
    totalLength += buf.byteLength;
  }
  
  // Combine into single buffer
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  
  return combined.buffer;
}

/**
 * Parse transcribed text into structured highlight data.
 * Expected pattern: "페이지 42. 인용문: ... 메모: ..."
 * IMPORTANT FIX: Ensures at least one field (quote or note) contains the full text as fallback.
 */
export function parseTranscription(text: string): TranscriptionResult {
  const result: TranscriptionResult = {
    text: text,
    page: "",
    quote: "",
    note: "",
  };

  const cleanedText = cleanTranscriptionText(text);
  
  // Try to match the expected pattern
  // Pattern variations to handle different speech recognition outputs
  const patterns = [
    // Standard pattern: 페이지 42. 인용문: ... 메모: ...
    new RegExp("페이지\\s*(\\d+)[.:\\s,]*인용문[:\\s]+(.+?)\\s*메모[:\\s]+(.+)", "is"),
    // Alternative: 페이지 42 인용문 ... 메모 ...
    new RegExp("페이지\\s*(\\d+)[.:\\s,]*인용문\\s+(.+?)\\s+메모\\s+(.+)", "is"),
    // Page number with only quote: 페이지 42. 인용문: ...
    new RegExp("페이지\\s*(\\d+)[.:\\s,]*인용문[:\\s]+(.+)", "is"),
    // Page number with only note: 페이지 42. 메모: ...
    new RegExp("페이지\\s*(\\d+)[.:\\s,]*메모[:\\s]+(.+)", "is"),
    // Just page number and content: 페이지 42. ...
    new RegExp("페이지\\s*(\\d+)[.:\\s,]+(.+)", "is"),
  ];

  for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
    const pattern = patterns[patternIndex];
    const match = text.match(pattern);
    
    if (match) {
      result.page = match[1];
      
      if (patternIndex <= 1 && match.length >= 4) {
        // Full pattern with quote and note
        result.quote = cleanTranscriptionText(match[2]);
        result.note = cleanTranscriptionText(match[3]);
      } else if (patternIndex === 2 && match.length >= 3) {
        // Quote only pattern - use quote, put full text in note as backup
        result.quote = cleanTranscriptionText(match[2]);
        // Don't leave note empty - user might want context
      } else if (patternIndex === 3 && match.length >= 3) {
        // Note only pattern
        result.note = cleanTranscriptionText(match[2]);
      } else if (patternIndex === 4 && match.length >= 3) {
        // Just page and content - treat as note
        result.note = cleanTranscriptionText(match[2]);
      }
      
      // IMPORTANT FIX: Ensure we don't lose user content
      // If both quote and note are empty after parsing, use the full text
      if (!result.quote && !result.note) {
        result.note = cleanedText;
      }
      
      return result;
    }
  }

  // No pattern matched - treat entire text as note
  // This ensures we never lose the user's voice input
  result.note = cleanedText;
  
  return result;
}

/**
 * Clean up transcription text
 */
function cleanTranscriptionText(text: string): string {
  return text
    .replace(/^\s+|\s+$/g, "") // Trim
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/^[.\s,]+|[.\s,]+$/g, ""); // Remove leading/trailing punctuation
}
