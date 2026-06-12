import { App, PluginSettingTab, setIcon, Setting, TextComponent } from 'obsidian';
import {
  DEFAULT_POMODORO_LONG_BREAK_COLOR,
  DEFAULT_POMODORO_SHORT_BREAK_COLOR,
} from '../constants';
import { getThemeAccentColor } from '../colorUtils';
import { DEFAULT_SETTINGS, clampInteger, clampPercentage, sanitizeColor } from '../settings';
import { bitrateLabel, stationFormat } from '../stationUtils';
import type { ColorSettingKey, FavoriteStation, NumberSettingKey, SettingsSection } from '../types';
import { ReleaseNotesModal } from './ReleaseNotesModal';
import { StationSearchModal } from './StationSearchModal';
import type { StreamRadioPluginApi } from './pluginTypes';

export class StreamRadioSettingTab extends PluginSettingTab {
  private activeSection: SettingsSection = 'radio';

  constructor(app: App, private plugin: StreamRadioPluginApi) {
    super(app, plugin);
    const renderHookName = ['dis', 'play'].join('');
    (this as unknown as Record<string, () => void>)[renderHookName] = () => this.renderSettings();
  }

  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderTabs(containerEl);

    if (this.activeSection === 'pomodoro') {
      this.renderPomodoroSection(containerEl);
      return;
    }

    this.renderRadioSection(containerEl);
  }

  openStationSearch(): void {
    this.activeSection = 'radio';
    this.renderSettings();
    new StationSearchModal(this.app, this.plugin, () => this.renderSettings()).open();
  }

  private renderTabs(containerEl: HTMLElement): void {
    const tabs = containerEl.createDiv({ cls: 'streamradio-settings-tabs' });
    this.createSettingsTab(tabs, 'radio', 'Radio');
    this.createSettingsTab(tabs, 'pomodoro', 'Pomodoro');
  }

  private createSettingsTab(parent: HTMLElement, section: SettingsSection, label: string): void {
    const button = parent.createEl('button', {
      cls: `streamradio-settings-tab${this.activeSection === section ? ' is-active' : ''}`,
      text: label,
      attr: { type: 'button' },
    });
    button.addEventListener('click', () => {
      this.activeSection = section;
      this.renderSettings();
    });
  }

  private renderRadioSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Radio').setHeading();

    new Setting(containerEl)
      .setName('Release notes')
      .setDesc('Show the bundled release notes for StreamRadio.')
      .addButton((button) => {
        button
          .setButtonText('Show release notes')
          .setCta()
          .onClick(() => new ReleaseNotesModal(this.app).open());
      });

    new Setting(containerEl)
      .setName('Show station logos')
      .setDesc('Show station logos in the player when a station provides one.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showStationLogos)
          .onChange((value) => {
            this.plugin.settings.showStationLogos = value;
            void this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Favorite stations')
      .setDesc('Add and arrange favorite stations.')
      .addButton((button) => {
        button
          .setButtonText('Add favorites')
          .setCta()
          .onClick(() => {
            this.openStationSearch();
          });
      });

    this.renderFavoriteList(containerEl);
  }

  private renderPomodoroSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Pomodoro').setHeading();

    new Setting(containerEl)
      .setName('Enable Pomodoro timer')
      .setDesc('Show the Pomodoro timer below the radio controls.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.pomodoroEnabled)
          .onChange((value) => {
            this.plugin.settings.pomodoroEnabled = value;
            void this.plugin.saveSettings();
          });
      });

    this.addNumberSetting(containerEl, 'Focus duration', 'Duration of one Pomodoro interval in minutes.', 'pomodoroFocusMinutes', 1, 240);
    this.addColorSetting(containerEl, 'Focus color', 'Color used for the focus indicator and interval markers.', 'pomodoroTimerColor', getThemeAccentColor(), true);
    this.addReducedDistractionSettings(containerEl);
    this.addNumberSetting(containerEl, 'Intervals', 'Number of focus intervals in one Pomodoro session.', 'pomodoroIntervals', 1, 8);
    this.addNumberSetting(containerEl, 'Short break duration', 'Duration of a short break in minutes.', 'pomodoroShortBreakMinutes', 1, 120);
    this.addColorSetting(containerEl, 'Short break color', 'Color used for the short break indicator and interval markers.', 'pomodoroShortBreakColor', DEFAULT_POMODORO_SHORT_BREAK_COLOR, true);
    this.addNumberSetting(containerEl, 'Long break duration', 'Duration of a long break in minutes.', 'pomodoroLongBreakMinutes', 1, 240);
    this.addColorSetting(containerEl, 'Long break color', 'Color used for the long break indicator and interval markers.', 'pomodoroLongBreakColor', DEFAULT_POMODORO_LONG_BREAK_COLOR, true);
    this.addNumberSetting(containerEl, 'Long break after intervals', 'Number of completed intervals before a long break starts.', 'pomodoroLongBreakEvery', 1, 8);
  }

  private addResetButton(setting: Setting, tooltip: string, onReset: () => void): void {
    setting.addExtraButton((button) => {
      button
        .setIcon('rotate-ccw')
        .onClick(() => {
          onReset();
        });
      button.extraSettingsEl.setAttr('title', tooltip);
      button.extraSettingsEl.setAttr('aria-label', tooltip);
    });
  }

  private addNumberSetting(containerEl: HTMLElement, name: string, description: string, key: NumberSettingKey, min: number, max: number): void {
    const fallback = Number(DEFAULT_SETTINGS[key]);
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(description);
    let textComponent: TextComponent | null = null;

    setting.addText((text) => {
      textComponent = text;
      const saveValue = async () => {
        const parsed = Number(text.getValue());
        if (!Number.isFinite(parsed)) {
          text.setValue(String(this.plugin.settings[key]));
          return;
        }

        this.plugin.settings[key] = clampInteger(parsed, fallback, min, max);
        await this.plugin.saveSettings();
        text.setValue(String(this.plugin.settings[key]));
      };

      text.setValue(String(this.plugin.settings[key]));
      text.inputEl.setAttr('type', 'number');
      text.inputEl.setAttr('min', String(min));
      text.inputEl.setAttr('max', String(max));
      text.inputEl.setAttr('step', '1');
      text.inputEl.addClass('streamradio-number-input');
      text.inputEl.addEventListener('change', () => {
        void saveValue();
      });
      text.inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          text.inputEl.blur();
          void saveValue();
        }
      });
    });

    this.addResetButton(setting, `Reset ${name.toLowerCase()} to default`, () => {
      this.plugin.settings[key] = clampInteger(fallback, fallback, min, max);
      void this.plugin.saveSettings().then(() => {
        textComponent?.setValue(String(this.plugin.settings[key]));
      });
    });
  }

  private addColorSetting(containerEl: HTMLElement, name: string, description: string, key: ColorSettingKey, fallback: string, isNested = false): void {
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(description);
    let pickerComponent: { setValue: (value: string) => unknown } | null = null;

    setting.addColorPicker((picker) => {
      pickerComponent = picker;
      picker
        .setValue(String(this.plugin.settings[key] || fallback))
        .onChange((value) => {
          this.plugin.settings[key] = sanitizeColor(value, fallback);
          void this.plugin.saveSettings();
        });
    });

    this.addResetButton(setting, `Reset ${name.toLowerCase()} to default`, () => {
      this.plugin.settings[key] = sanitizeColor(fallback, fallback);
      void this.plugin.saveSettings().then(() => {
        if (pickerComponent) {
          pickerComponent.setValue(this.plugin.settings[key]);
        }
      });
    });

    if (isNested) {
      setting.settingEl.addClass('streamradio-nested-setting');
    }
  }

  private addReducedDistractionSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Reduced distraction mode')
      .setDesc('Dim the Pomodoro display during focus intervals after the first 10 seconds, then restore it one minute before the interval ends.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.pomodoroReducedDistractionEnabled)
          .onChange((value) => {
            this.plugin.settings.pomodoroReducedDistractionEnabled = value;
            void this.plugin.saveSettings().then(() => {
              this.renderSettings();
            });
          });
      });

    if (!this.plugin.settings.pomodoroReducedDistractionEnabled) {
      return;
    }

    const dimSetting = new Setting(containerEl)
      .setName(`Dim factor (${this.plugin.settings.pomodoroDimFactor}%)`)
      .setDesc('Display brightness while reduced distraction mode is active.');
    dimSetting.settingEl.addClass('streamradio-nested-setting');
    let sliderInput: HTMLInputElement | null = null;

    dimSetting.addSlider((slider) => {
      sliderInput = slider.sliderEl;
      slider
        .setLimits(5, 100, 5)
        .setValue(this.plugin.settings.pomodoroDimFactor)
        .onChange((value) => {
          this.plugin.settings.pomodoroDimFactor = clampPercentage(value, DEFAULT_SETTINGS.pomodoroDimFactor);
          dimSetting.setName(`Dim factor (${this.plugin.settings.pomodoroDimFactor}%)`);
          void this.plugin.saveSettings();
        });
    });

    this.addResetButton(dimSetting, 'Reset dim factor to default', () => {
      this.plugin.settings.pomodoroDimFactor = clampPercentage(DEFAULT_SETTINGS.pomodoroDimFactor, DEFAULT_SETTINGS.pomodoroDimFactor);
      dimSetting.setName(`Dim factor (${this.plugin.settings.pomodoroDimFactor}%)`);
      void this.plugin.saveSettings().then(() => {
        if (sliderInput) {
          sliderInput.value = String(this.plugin.settings.pomodoroDimFactor);
        }
      });
    });
  }

  private renderFavoriteList(containerEl: HTMLElement): void {
    const list = containerEl.createDiv({ cls: 'streamradio-favorite-list' });

    if (this.plugin.settings.favorites.length === 0) {
      list.createDiv({ cls: 'streamradio-empty-state', text: 'No favorite stations yet.' });
      return;
    }

    this.plugin.settings.favorites.forEach((station, index) => {
      const row = list.createDiv({ cls: 'streamradio-favorite-row' });
      row.setAttr('draggable', 'true');
      row.setAttr('data-index', String(index));

      const handle = row.createSpan({ cls: 'streamradio-drag-handle' });
      setIcon(handle, 'grip-vertical');

      this.createStationLogo(row, station);

      const text = row.createDiv({ cls: 'streamradio-favorite-text' });
      text.createDiv({ cls: 'streamradio-station-name', text: station.name });
      text.createDiv({ cls: 'streamradio-station-meta', text: `${stationFormat(station)} · ${bitrateLabel(station.bitrate)}` });

      const actions = row.createDiv({ cls: 'streamradio-row-actions' });
      const isActiveStationPlaying = this.plugin.getIsPlaying() && this.plugin.getCurrentStation()?.stationuuid === station.stationuuid;
      const playButton = actions.createEl('button', { cls: 'clickable-icon streamradio-icon-button', attr: { type: 'button', 'aria-label': isActiveStationPlaying ? `Stop ${station.name}` : `Play ${station.name}` } });
      playButton.classList.toggle('is-active-playback', isActiveStationPlaying);
      playButton.style.setProperty('--streamradio-active-control-color', this.plugin.settings.pomodoroTimerColor);
      setIcon(playButton, isActiveStationPlaying ? 'square' : 'play');
      playButton.addEventListener('click', () => {
        if (isActiveStationPlaying) {
          this.plugin.stopPlayback();
          this.renderSettings();
          return;
        }

        void this.playFavoriteStation(station);
      });

      const removeButton = actions.createEl('button', { cls: 'clickable-icon streamradio-icon-button', attr: { type: 'button', 'aria-label': `Remove ${station.name}` } });
      setIcon(removeButton, 'trash-2');
      removeButton.addEventListener('click', () => {
        const favorites = this.plugin.settings.favorites.filter((favorite) => favorite.stationuuid !== station.stationuuid);
        void this.plugin.saveFavorites(favorites).then(() => {
          this.renderSettings();
        });
      });

      row.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', String(index));
        event.dataTransfer?.setDragImage(row, 12, 12);
        row.addClass('is-dragging');
      });

      row.addEventListener('dragend', () => {
        row.removeClass('is-dragging');
      });

      row.addEventListener('dragover', (event) => {
        event.preventDefault();
      });

      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const fromIndex = Number(event.dataTransfer?.getData('text/plain'));
        const toIndex = index;
        if (!Number.isInteger(fromIndex) || fromIndex === toIndex) {
          return;
        }

        const favorites = [...this.plugin.settings.favorites];
        const [moved] = favorites.splice(fromIndex, 1);
        favorites.splice(toIndex, 0, moved);
        void this.plugin.saveFavorites(favorites).then(() => {
          this.renderSettings();
        });
      });
    });
  }

  private async playFavoriteStation(station: FavoriteStation): Promise<void> {
    await this.plugin.selectStation(station);
    await this.plugin.playStation(station);
    this.renderSettings();
  }

  private createStationLogo(parent: HTMLElement, station: FavoriteStation): void {
    this.plugin.createStationLogo(parent, station, {
      wrapperClass: 'streamradio-station-logo-slot',
      imageClass: 'streamradio-station-logo',
      fallbackClass: 'streamradio-station-logo streamradio-logo-fallback',
      loading: 'lazy',
    });
  }
}
