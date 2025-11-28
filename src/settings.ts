import { App, PluginSettingTab, Setting, TextComponent, TextAreaComponent, ToggleComponent, ButtonComponent } from "obsidian";
import type BookVoiceCapturePlugin from "../main";

export interface BookVoiceCaptureSettings {
  openAIApiKey: string;
  openAIWhisperModel: string;
  booksFolder: string;
  bookNoteTemplate: string;
  highlightBlockTemplate: string;
  kyoboEnabled: boolean;
}

export const DEFAULT_SETTINGS: BookVoiceCaptureSettings = {
  openAIApiKey: "",
  openAIWhisperModel: "whisper-1",
  booksFolder: "Books",
  kyoboEnabled: true,
  bookNoteTemplate: `---
type: book
title: "{{title}}"
author: "{{author}}"
publisher: "{{publisher}}"
published: "{{publishedDate}}"
isbn: "{{isbn}}"
source: "Kyobo"
status: "reading"
kyoboUrl: "{{kyoboUrl}}"
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

    // Books Folder
    new Setting(containerEl)
      .setName("Books Folder")
      .setDesc("The folder where book notes will be created.")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder("Books")
          .setValue(this.plugin.settings.booksFolder)
          .onChange(async (value: string) => {
            this.plugin.settings.booksFolder = value || "Books";
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

    // Book Note Template
    containerEl.createEl("h3", { text: "Templates" });

    new Setting(containerEl)
      .setName("Book Note Template")
      .setDesc(
        "Template for new book notes. Available placeholders: {{title}}, {{author}}, {{publisher}}, {{publishedDate}}, {{isbn}}, {{kyoboUrl}}"
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
