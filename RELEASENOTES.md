# StreamRadio Release Notes

## Version 1.4.1

### Improved

- The "Select station" list contains now an "+ Add favorites" button to add quicker and easier further stations.

## Version 1.4.0

### Added

- You can now add and manage custom radio streams, which are not available in the catalog.
- The favicons are now clickable and open the station's website in the browser. 
- For existing favorite list: The website URLs are silently added in the background and connected to the favicons. No user interaction is needed.

### Improved

- The onboarding process (first time use with empty favorites list) leads the user directly to the search in settings. 

## Version 1.3.5

### Changed

- The stop icons in active radio, favorites list and preview now use the configured focus/accent color for better legibility.

### Fixed

- Fixed an edge case for missing station icons.
- Fixed flickering controls for player and timer.
- Normalization for broken station payloads.

## Version 1.3.1

### Added

- Added ICY metadata retrieval for desktop playback, showing the current track as `title / artist` below the station name when streams provide metadata.
- Added smooth overflow scrolling for long track metadata in the player.
- Re-factored code for better modularity

### Changed

- Removed the station details popover from the player logo so the player header stays focused on station name and live track metadata.

## Version 1.2.1

### Added

- Added a mute toggle on the player volume control that restores the previous volume when unmuted.
- Added HTTP HEAD validation for station icons with automatic fallback to the default StreamRadio icon.
- Added reset buttons for editable Pomodoro settings so durations, interval counts, colors, and dim factor can be restored to their defaults quickly.

### Changed

- Countdown beeps now temporarily duck radio playback volume during the last 10 seconds of a focus interval or break, then restore it automatically after the warning and completion beeps finish.
- Station details are now shown in a hover popover on the station icon instead of under the station name.
- Pomodoro focus markers now pulse only while a focus interval is actively running.
- Pomodoro dim and visibility toolbar buttons now persist their state across restarts and use larger controls for better recognition.

### Fixed

- Fixed unavailable station logos being shown inconsistently across the player, favorites, search results, and station picker.
- Improved audibility of Pomodoro warning and completion beeps while radio playback is active.

## Version 1.2.0

### Added

- Introduce a reduced distraction mode for the Pomodoro display, allowing users to dim the display during focus intervals and toggle its visibility. 
- Improve UI responsiveness and transitions.
- Update styles for better layout and accessibility.

### Changed

- Increased Pomodoro beep volume for better audibility.
- Pomodoro duration changes now apply immediately to the current timer without requiring a manual reset.
- Improved Obsidian plugin review compatibility while keeping support for the current public Obsidian release line.

### Fixed

- Fixed Pomodoro timer state staying on the old duration after changing focus or break duration settings.
- Replaced review-flagged API and callback patterns with compatibility-safe alternatives.

## Version 1.1.0

### Added

- Added an optional Pomodoro timer below the radio player.
- Added Pomodoro settings for focus duration, interval count, short break duration, long break duration, long-break cadence, and focus/break colors.
- Added Pomodoro interval markers, a countdown ring, phase labels, and controls for restart, start/pause, skip, and reset.
- Added Pomodoro completion and break-ending audio cues.
- Added reduced distraction mode for dimming focus intervals and a hide/show control for the Pomodoro display.

### Changed

- The default Pomodoro focus color is initialized from Obsidian's Appearance > Accent color.

## Version 1.0.1

### Added

- Added station search through radio-browser.info.
- Added favorite station management.
- Added drag and drop sorting for favorites.
- Added station preview playback in the search modal.
- Added a right sidebar player view with start, pause, next, station picker, and sleep timer controls.
- Added bundled release notes in the settings tab.
- Added station logo visibility setting.

### Notes

- StreamRadio does not autoplay after Obsidian starts. The user must explicitly start playback.
- Live artist and song metadata is not displayed because browser audio playback does not expose ICY metadata reliably.


