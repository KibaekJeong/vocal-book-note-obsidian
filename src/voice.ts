import { Modal, App, Notice } from "obsidian";

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
  private onComplete: (blob: Blob) => void;
  private onCancel: () => void;

  constructor(
    app: App,
    onComplete: (blob: Blob) => void,
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
    indicatorEl.createDiv({ cls: "book-voice-capture-recording-dot" });
    indicatorEl.createSpan({ text: "Recording..." });

    // Timer
    this.timerEl = contentEl.createDiv({ cls: "book-voice-capture-timer", text: "00:00" });

    // Instructions
    contentEl.createEl("p", { 
      text: 'Speak in format: "페이지 [number]. 인용문: [quote]. 메모: [note]"',
      cls: "book-voice-capture-instructions"
    });

    // Buttons
    const buttonsEl = contentEl.createDiv({ cls: "book-voice-capture-buttons" });
    
    const stopBtn = buttonsEl.createEl("button", { 
      text: "Stop & Transcribe",
      cls: "book-voice-capture-stop-btn"
    });
    stopBtn.onclick = (): void => this.stopRecording();

    const cancelBtn = buttonsEl.createEl("button", { 
      text: "Cancel",
      cls: "book-voice-capture-cancel-btn"
    });
    cancelBtn.onclick = (): void => this.cancelRecording();

    // Start recording
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

      this.mediaRecorder.onstop = (): void => {
        const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        this.cleanup();
        this.close();
        this.onComplete(audioBlob);
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
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4",
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

  private stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
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
 * Transcribe audio blob using OpenAI Whisper API
 */
export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  model: string = "whisper-1"
): Promise<string> {
  // Convert blob to file format
  const audioFile = new File([audioBlob], "recording.webm", { type: audioBlob.type });

  // Create form data
  const formData = new FormData();
  formData.append("file", audioFile);
  formData.append("model", model);
  formData.append("language", "ko"); // Korean language hint
  formData.append("response_format", "text");

  try {
    // Use fetch for FormData since requestUrl doesn't handle it well
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Book Voice Capture] Whisper API error:", errorText);
      throw new Error(`Whisper API error: ${response.status} - ${errorText}`);
    }

    const transcription = await response.text();
    console.log("[Book Voice Capture] Transcription result:", transcription);
    return transcription.trim();

  } catch (error) {
    console.error("[Book Voice Capture] Transcription failed:", error);
    throw error;
  }
}

/**
 * Parse transcribed text into structured highlight data
 * Expected pattern: "페이지 42. 인용문: ... 메모: ..."
 */
export function parseTranscription(text: string): TranscriptionResult {
  const result: TranscriptionResult = {
    text: text,
    page: "",
    quote: "",
    note: "",
  };

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
        // Quote only pattern
        result.quote = cleanTranscriptionText(match[2]);
      } else if (patternIndex === 3 && match.length >= 3) {
        // Note only pattern
        result.note = cleanTranscriptionText(match[2]);
      } else if (patternIndex === 4 && match.length >= 3) {
        // Just page and content - treat as note
        result.note = cleanTranscriptionText(match[2]);
      }
      
      return result;
    }
  }

  // No pattern matched - treat entire text as note
  console.log("[Book Voice Capture] No pattern matched, using full text as note");
  result.note = cleanTranscriptionText(text);
  
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
