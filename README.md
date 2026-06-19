# Sheet Metal Bend Calculator

A static browser app for experimenting with sheet metal flange dimensions, bend angles, bend direction, bend allowance, outside setback, bend deduction, cross-section views, and flat-pattern bend-line views.

## Features

- Inch/mm unit toggle
- Material preset selector
- Editable material thickness, K-factor, and bend radius
- Add/remove flanges
- Per-flange bend angle, bend direction, and length basis
- Cross-section view with draggable CAD-style dimensions
- Flat view with bend-line dimensions
- Zoom, pan, and fit controls for both views
- Light/dark theme toggle
- Browser print workflow for saving both views as a PDF
- Schematic app icon for browser tabs and Windows desktop shortcuts

## Requirements

No build tools or package installation are required.

You only need:

- A modern browser
- Python 3 only if you want to run the app with a local web server

The app can be opened directly from `index.html`. A local web server is optional for development.

## Easy Install For Non-Technical Users

Download or clone this project, then run the installer for your operating system from the project folder.

### macOS

Double-click:

```text
install-mac.command
```

This creates a desktop shortcut named:

```text
Sheet Metal Bend Calculator.app
```

If macOS blocks the script because it was downloaded from the internet, right-click `install-mac.command`, choose `Open`, then confirm.

The macOS launcher uses the included schematic icon file, `app-icon.icns`.

### Windows

Double-click:

```text
install-windows.bat
```

This creates a desktop shortcut named:

```text
Sheet Metal Bend Calculator.url
```

The shortcut opens the app in the user's default browser.

The Windows shortcut uses the included schematic icon file, `app-icon.ico`.

## Run Locally

For development, or if you prefer to serve the files locally, use Python's built-in static server.

From the project directory:

```sh
python3 -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173
```

If port `5173` is already in use, choose another port:

```sh
python3 -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080
```

## Project Files

- `index.html` - app markup
- `styles.css` - layout, light/dark themes, and SVG/CAD styling
- `app.js` - calculator logic, drawing logic, interactions, and PDF export workflow
- `materials.json` - starter material preset data
- `materials-data.js` - embedded material preset fallback for direct `index.html` use
- `app-icon.svg` - schematic browser/favicon icon
- `app-icon.ico` - schematic Windows shortcut icon
- `app-icon.icns` - schematic macOS app launcher icon
- `install-mac.command` - macOS desktop app launcher installer
- `install-windows.bat` - Windows desktop shortcut installer

## Using The App

Both drawing views auto-fit to their panel when loaded. Use the mouse wheel or trackpad scroll to zoom, drag empty space to pan, and the `Fit` button to reset a view.

In the cross-section view, each inside, outside, and bend-line dimension can be dragged independently along its perpendicular dimension axis.

Use the `Dark` / `Light` button in the header to switch themes. The app remembers the selected theme in the browser.

Use `Export PDF` above the drawing panels to download a PDF containing both the cross-section and flat views.

## Current Calculation Model

- Bend allowance: `BA = PI * (R + K * T) * A / 180`
- Outside setback: `OSSB = (R + T) * tan(A / 2)`
- Bend deduction: `BD = 2 * OSSB - BA`
- Flange length conversion uses adjacent inside, outside, and neutral-axis setbacks.

## Material Data

The included `materials.json` file is starter reference data and can be edited directly. Add or remove entries using the same object structure already present in the file.

## Privacy / Public Repo Notes

This project is a static app. It does not collect data, call external APIs, include analytics, or transmit user input. Theme preference is stored locally in the browser using `localStorage`.
