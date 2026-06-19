import { App, Modal } from 'obsidian';

export class ConfirmFavoriteRemovalModal extends Modal {
  constructor(
    app: App,
    private stationName: string,
    private onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Remove favorite');

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: `Remove "${this.stationName}" from favorites?` });

    const actions = contentEl.createDiv({ cls: 'modal-button-container' });
    const cancelButton = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    const removeButton = actions.createEl('button', { text: 'Remove', cls: 'mod-warning', attr: { type: 'button' } });

    cancelButton.addEventListener('click', () => this.close());
    removeButton.addEventListener('click', () => {
      removeButton.disabled = true;
      cancelButton.disabled = true;
      void this.onConfirm().finally(() => this.close());
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}