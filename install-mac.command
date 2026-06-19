#!/bin/zsh
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_FILE="$APP_DIR/index.html"
APP_BUNDLE="$HOME/Desktop/Sheet Metal Bend Calculator.app"
LAUNCHER="$APP_BUNDLE/Contents/MacOS/SheetMetalBendCalculator"
RESOURCES="$APP_BUNDLE/Contents/Resources"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$RESOURCES"

cp "$APP_DIR/app-icon.icns" "$RESOURCES/app-icon.icns"

cat > "$APP_BUNDLE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Sheet Metal Bend Calculator</string>
  <key>CFBundleDisplayName</key>
  <string>Sheet Metal Bend Calculator</string>
  <key>CFBundleIdentifier</key>
  <string>com.sheetmetal.bendcalculator</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>SheetMetalBendCalculator</string>
  <key>CFBundleIconFile</key>
  <string>app-icon</string>
</dict>
</plist>
EOF

cat > "$LAUNCHER" <<EOF
#!/bin/zsh
open "$APP_FILE"
EOF

chmod +x "$LAUNCHER"

echo "Desktop app launcher created:"
echo "$APP_BUNDLE"
echo
echo "You can close this window."
