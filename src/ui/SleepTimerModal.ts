import { App, ButtonComponent, Modal, TextComponent } from 'obsidian';
import type { StreamRadioPluginApi } from './pluginTypes';

export class SleepTimerModal extends Modal {
  private selectedMinutes = 15;
  private customInput: TextComponent | null = null;

  constructor(app: App, private plugin: StreamRadioPluginApi) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Sleep timer');
    this.contentEl.empty();
    this.contentEl.addClass('streamradio-timer-modal');

    const options = [5, 10, 15, 30, 45, 60, 120];
    const optionGroup = this.contentEl.createDiv({ cls: 'streamradio-timer-options' });

    for (const minutes of options) {
      const label = optionGroup.createEl('label', { cls: 'streamradio-radio-option' });
      const input = label.createEl('input', { attr: { type: 'radio', name: 'streamradio-timer', value: String(minutes) } });
      input.checked = minutes === this.selectedMinutes;
      input.addEventListener('change', () => {
        this.selectedMinutes = minutes;
      });
      label.createSpan({ text: `${minutes} min` });
    }

    const customLabel = optionGroup.createEl('label', { cls: 'streamradio-radio-option streamradio-custom-timer' });
    const customRadio = customLabel.createEl('input', { attr: { type: 'radio', name: 'streamradio-timer', value: 'custom' } });
    customLabel.createSpan({ text: 'Custom' });
    this.customInput = new TextComponent(customLabel).setPlaceholder('Minutes');
    this.customInput.inputEl.setAttr('inputmode', 'numeric');
    this.customInput.onChange((value) => {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        this.selectedMinutes = parsed;
        customRadio.checked = true;
      }
    });
    customRadio.addEventListener('change', () => {
      const parsed = Number(this.customInput?.getValue() || '');
      if (Number.isFinite(parsed) && parsed > 0) {
        this.selectedMinutes = parsed;
      }
    });

    const actions = this.contentEl.createDiv({ cls: 'streamradio-modal-actions' });
    new ButtonComponent(actions)
      .setButtonText('Start timer')
      .setCta()
      .onClick(() => {
        this.plugin.startSleepTimer(this.selectedMinutes);
        this.close();
      });

    new ButtonComponent(actions)
      .setButtonText('Clear timer')
      .onClick(() => {
        this.plugin.clearSleepTimer();
        this.close();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
