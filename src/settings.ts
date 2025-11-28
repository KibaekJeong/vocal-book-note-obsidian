import {
  App,
  PluginSettingTab,
  Setting,
  TextComponent,
  TextAreaComponent,
  ToggleComponent,
  ButtonComponent,
  normalizePath,
} from "obsidian";
import type BookVoiceCapturePlugin from "../main";

export interface BookVoiceCaptureSettings {
  openAIApiKey: string;
  openAIWhisperModel: string;
  booksFolder: string;
  baseFolder: string;
  baseFilePath: string;
  dataFolder: string;
  bookNoteTemplate: string;
  highlightBlockTemplate: string;
  kyoboEnabled: boolean;
  // GPT Summary settings
  enableGptSummary: boolean;
  gptSummaryModel: string;
  gptMaxTokens: number;
  gptTemperature: number;
}

export const DEFAULT_SETTINGS: BookVoiceCaptureSettings = {
  openAIApiKey: "",
  openAIWhisperModel: "whisper-1",
  booksFolder: "Books",
  baseFolder: "Books",
  baseFilePath: "Base/Books.base",
  dataFolder: "Books",
  kyoboEnabled: true,
  // GPT Summary defaults
  enableGptSummary: false,
  gptSummaryModel: "gpt-4o-mini",
  gptMaxTokens: 2500,
  gptTemperature: 0.7,
  bookNoteTemplate: `---
Type: Book
Area: ""
Goal: ""
Status: "reading"
title: "{{title}}"
author: "{{author}}"
publisher: "{{publisher}}"
publishedDate: "{{schema:@Book:workExample[0].datePublished}}"
Cover: "{{image}}"
url: "{{kyoboUrl}}"
Topics: "{{schema:@Book:keywords}}"
Genre: "{{meta:property:eg:category2_name}}"
Rating: "{{schema:@Book:aggregateRating.ratingValue}}"
'start reading': "{{currentDate}}"
'end reading': ""
Description: "{{schema:@Book:description}}"
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

`,
  highlightBlockTemplate: `### p.{{page}}

> {{quote}}

- 메모: {{note}}
- 캡처일: {{date}}

`,
};

export class BookVoiceCaptureSettingTab extends PluginSettingTab {
  plugin: BookVoiceCapturePlugin;

  constructor(app: App, plugin: BookVoiceCapturePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.addClass("book-voice-capture-settings");

    containerEl.createEl("h2", { text: "Book Voice Capture Settings" });

    // OpenAI API Key
    new Setting(containerEl)
      .setName("OpenAI API Key")
      .setDesc("Your OpenAI API key for Whisper transcription.")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openAIApiKey)
          .onChange(async (value: string) => {
            this.plugin.settings.openAIApiKey = value;
            await this.plugin.saveSettings();
          })
      )
      .then((setting: Setting) => {
        const inputEl = setting.controlEl.querySelector("input");
        if (inputEl) {
          inputEl.type = "password";
          inputEl.style.width = "300px";
        }
      });

    // Whisper Model
    new Setting(containerEl)
      .setName("Whisper Model")
      .setDesc("The OpenAI Whisper model to use (default: whisper-1).")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder("whisper-1")
          .setValue(this.plugin.settings.openAIWhisperModel)
          .onChange(async (value: string) => {
            this.plugin.settings.openAIWhisperModel = value || "whisper-1";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Base & Data Layout" });

    new Setting(containerEl)
      .setName("Base Folder")
      .setDesc("Root folder that contains your Base file and book data (e.g., Snipd, Books).")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder(this.plugin.settings.baseFolder || "Books")
          .setValue(this.plugin.settings.baseFolder)
          .onChange(async (value: string) => {
            const normalized = value?.trim() ? normalizePath(value.trim()) : "Books";
            this.plugin.settings.baseFolder = normalized;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Base File Path")
      .setDesc("Relative path under the base folder for your Obsidian Base file (e.g., Base/Books.base).")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder(this.plugin.settings.baseFilePath || "Base/Books.base")
          .setValue(this.plugin.settings.baseFilePath)
          .onChange(async (value: string) => {
            const normalized = value?.trim() ? normalizePath(value.trim()) : "Base/Books.base";
            this.plugin.settings.baseFilePath = normalized;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Book Pages Folder")
      .setDesc("Folder where individual book notes will be stored. Leave empty to reuse the base folder.")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder(this.plugin.settings.dataFolder || "Books")
          .setValue(this.plugin.settings.dataFolder || this.plugin.settings.booksFolder)
          .onChange(async (value: string) => {
            const fallback = this.plugin.settings.baseFolder || "Books";
            const normalized = value?.trim()
              ? normalizePath(value.trim())
              : fallback;
            this.plugin.settings.dataFolder = normalized;
            this.plugin.settings.booksFolder = normalized;
            await this.plugin.saveSettings();
          })
      );

    // Kyobo Enabled
    new Setting(containerEl)
      .setName("Enable Kyobo Scraping")
      .setDesc("Automatically fetch book metadata from Kyobo (교보문고) when creating book notes.")
      .addToggle((toggle: ToggleComponent) =>
        toggle
          .setValue(this.plugin.settings.kyoboEnabled)
          .onChange(async (value: boolean) => {
            this.plugin.settings.kyoboEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    // GPT Summary Section
    containerEl.createEl("h3", { text: "GPT Book Summary" });

    new Setting(containerEl)
      .setName("Enable GPT Book Summary")
      .setDesc("Generate AI-powered summary, key points, and quotes when creating new book notes. Requires OpenAI API key.")
      .addToggle((toggle: ToggleComponent) =>
        toggle
          .setValue(this.plugin.settings.enableGptSummary)
          .onChange(async (value: boolean) => {
            this.plugin.settings.enableGptSummary = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("GPT Model")
      .setDesc("The OpenAI model to use for generating summaries (e.g., gpt-4o-mini, gpt-4o).")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder("gpt-4o-mini")
          .setValue(this.plugin.settings.gptSummaryModel)
          .onChange(async (value: string) => {
            this.plugin.settings.gptSummaryModel = value || "gpt-4o-mini";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("GPT Max Tokens")
      .setDesc("Maximum tokens for GPT response (higher = longer summaries, more cost). Default: 2500.")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder("2500")
          .setValue(String(this.plugin.settings.gptMaxTokens))
          .onChange(async (value: string) => {
            const parsed = parseInt(value, 10);
            this.plugin.settings.gptMaxTokens = isNaN(parsed) ? 2500 : Math.max(500, Math.min(4000, parsed));
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("GPT Temperature")
      .setDesc("Creativity level (0.0-1.0). Lower = more factual, higher = more creative. Default: 0.7.")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder("0.7")
          .setValue(String(this.plugin.settings.gptTemperature))
          .onChange(async (value: string) => {
            const parsed = parseFloat(value);
            this.plugin.settings.gptTemperature = isNaN(parsed) ? 0.7 : Math.max(0, Math.min(1, parsed));
            await this.plugin.saveSettings();
          })
      );

    // Book Note Template
    containerEl.createEl("h3", { text: "Templates" });

    new Setting(containerEl)
      .setName("Book Note Template")
      .setDesc(
        "Template for new book notes. Available placeholders: {{title}}, {{author}}, {{publisher}}, {{schema:@Book:workExample[0].datePublished}}, {{kyoboUrl}}, {{image}}, {{coverImage}}, {{schema:@Book:keywords}}, {{topics}}, {{genre}}, {{meta:property:eg:category2_name}}, {{schema:@Book:aggregateRating.ratingValue}}, {{rating}}, {{schema:@Book:description}}, {{description}}, {{currentDate}}. The plugin will always enforce 'type: book' in the frontmatter even if your template omits it."
      )
      .addTextArea((text: TextAreaComponent) => {
        text
          .setPlaceholder("Enter your book note template...")
          .setValue(this.plugin.settings.bookNoteTemplate)
          .onChange(async (value: string) => {
            this.plugin.settings.bookNoteTemplate = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 15;
        text.inputEl.cols = 50;
        text.inputEl.style.width = "100%";
        text.inputEl.style.fontFamily = "monospace";
      });

    // Highlight Block Template
    new Setting(containerEl)
      .setName("Highlight Block Template")
      .setDesc(
        "Template for voice highlights. Available placeholders: {{page}}, {{quote}}, {{note}}, {{date}}"
      )
      .addTextArea((text: TextAreaComponent) => {
        text
          .setPlaceholder("Enter your highlight template...")
          .setValue(this.plugin.settings.highlightBlockTemplate)
          .onChange(async (value: string) => {
            this.plugin.settings.highlightBlockTemplate = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 8;
        text.inputEl.cols = 50;
        text.inputEl.style.width = "100%";
        text.inputEl.style.fontFamily = "monospace";
      });

    // Reset to Defaults
    new Setting(containerEl)
      .setName("Reset Templates to Defaults")
      .setDesc("Reset both templates to their default values.")
      .addButton((button: ButtonComponent) =>
        button.setButtonText("Reset").onClick(async () => {
          this.plugin.settings.bookNoteTemplate = DEFAULT_SETTINGS.bookNoteTemplate;
          this.plugin.settings.highlightBlockTemplate = DEFAULT_SETTINGS.highlightBlockTemplate;
          await this.plugin.saveSettings();
          this.display(); // Refresh the settings tab
        })
      );
  }
}
