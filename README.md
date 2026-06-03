[![GitHub Release](https://img.shields.io/github/v/release/fnsign/StreamRadio)](https://community.obsidian.md/plugins/streamradio)
[![GitHub License](https://img.shields.io/github/license/fnsign/StreamRadio?color=%23e4d312)](https://github.com/fnsign/StreamRadio/blob/main/LICENSE)
[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/fnsign/StreamRadio/total?label=plugin%20downloads)](https://community.obsidian.md/plugins/streamradio)

# StreamRadio

StreamRadio is an Obsidian plugin for searching web radio stations from radio-browser.info, saving favorites, and listening from the right sidebar.

## Features

- Search stations by name, country, language, and tag through the radio-browser.info API.
- Preview stations directly in the search dialog before saving them in your favorites list.
- Reorder favorites with drag and drop in the settings tab.
- Show or hide station logos in the player.
- Start, pause, skip to the previous station, and skip to the next favorite station from the right sidebar.
- Adjust playback volume with a slider in the player.
- Select a favorite station from a modal.
- Start a sleep timer with 5, 10, 15, 30, 45, 60, 120 minutes, or a custom minute value.

## Player

StreamRadio adds a radio icon to the left ribbon. The icon opens the StreamRadio player in Obsidian's right sidebar. If the sidebar already contains other views, StreamRadio opens as another tab.

The player shows:

- Station logo, when enabled and available
- Station name
- Country and language information
- Format and bitrate
- Playback controls
- Volume slider
- Sleep timer status


## Settings

The settings tab contains:

- A release notes button styled as a primary action.
- A toggle for station logos in the player.
- A button for opening the station search modal.
- The saved favorites list.

The search modal shows 20 results per page and displays the current page with the total page count. Additional results can be reached with previous and next arrow buttons. Every result row shows station logo, station name, format, bitrate, a favorite checkbox, and a preview play button.

## radio-browser.info

StreamRadio uses the public radio-browser.info API:

- `https://all.api.radio-browser.info/json/countries`
- `https://all.api.radio-browser.info/json/languages`
- `https://all.api.radio-browser.info/json/tags`
- `https://all.api.radio-browser.info/json/stations/search`

The plugin uses Obsidian's `requestUrl` API for network requests. StreamRadio is a desktop-only Obsidian plugin and supports Windows, macOS, and Linux.

## Obsidian guidelines

StreamRadio follows the Obsidian plugin guidelines:

- It uses the plugin instance `this.app` instead of the global app object.
- It avoids direct file system access.
- It stores plugin settings through Obsidian plugin data APIs.
- It uses Obsidian DOM helper methods instead of HTML string injection.
- It avoids `innerHTML`, `outerHTML`, and `insertAdjacentHTML`.
- It uses CSS classes and Obsidian CSS variables instead of hardcoded inline styling.
- It does not set default hotkeys.
- It cleans up audio playback and timers on unload.

## Disclosures

- This plugin uses the network to search and play public web radio streams.
- Station search data comes from radio-browser.info.
- Playback connects directly to the stream URL provided by each station.
- This plugin does not require an account.
- This plugin does not require payment for full functionality.
- This plugin does not include telemetry.
- This plugin does not show ads.
- This plugin does not read or write notes in your vault.

## Limitations

- Desktop only. Mobile Obsidian is not supported.
- Supported operating systems are Windows, macOS, and Linux.
- Stream availability depends on the station data provided by radio-browser.info and the radio station itself.
- Browser audio playback does not expose ICY stream metadata in a reliable cross-platform way. StreamRadio does not display live artist or song metadata.
- Drag and drop in the favorites list uses standard browser drag events because Obsidian does not provide a dedicated reorder-list component.
- Notebook Navigator compatibility does not require a special integration because StreamRadio does not add file explorer or note context menu actions.

## Build

Install dependencies:

```bash
npm install
```

Run a production build:

```bash
npm run build
```

The build bundles `RELEASENOTES.md` into `main.js` through the esbuild text loader. `RELEASENOTES.md` is build input, not a required runtime plugin file.

## License

MIT

## Donations

- [<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="BuyMeACoffee" width="100">](https://www.buymeacoffee.com/fozin)
- [PayPal.me](https://paypal.me/FoziN)
