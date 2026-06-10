import { Component, MarkdownRenderer, Modal } from 'obsidian';
import releaseNotes from '../../RELEASENOTES.md';

export class ReleaseNotesModal extends Modal {
  private renderComponent = new Component();

  onOpen(): void {
    this.renderComponent.load();
    this.titleEl.setText('Release notes');
    this.contentEl.empty();
    this.contentEl.addClass('streamradio-release-notes');
    void MarkdownRenderer.render(this.app, releaseNotes, this.contentEl, '', this.renderComponent);
  }

  onClose(): void {
    this.renderComponent.unload();
    this.contentEl.empty();
  }
}
