# StreamRadio Release Notes

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


