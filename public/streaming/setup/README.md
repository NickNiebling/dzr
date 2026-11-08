# OBS setup illustrations

The ten WebP assets are original DZR **click illustrations**, not screenshots. Every image is visibly marked “Illustration” and names Windows or macOS. The SVG sources in `sources/` are the editable originals. They contain no credentials, real user paths or copied screenshot pixels.

## UI references

- [Official OBS Scripting Guide](https://obsproject.com/kb/scripting-guide): Tools → Scripts, the scripts list on the left, editable properties on the right, and the **+** button below the list. Consulted 2026-11-08. The guide's illustrated OBS release and operating system are not identified; its discussion includes v26.1. No exact current OBS release is asserted by these illustrations.
- [DZR's distributed Lua script](../../../apps/bot/assets/dzr-stream.lua): the actual fields are **DZR endpoint**, **DZR key**, and the optional **YouTube-videolink**. The key field is masked. There is no platform picker in the current script UI.
- Windows and macOS file-navigation controls are schematic representations. Menu labels, window decoration, translations and theme can differ on the user's computer. `Documents / Dokumenter → DZR` is an example permanent location, not an assumed or automatically discovered filesystem path.

Authentic current Windows/macOS screenshots were not available in this Linux execution environment. These illustrations are the approved MVP fallback; they must not be described as native screenshots or evidence of a successful installation. Native acceptance testing remains required on Windows and macOS with official OBS Studio. Check Tools/Scripts, **+**, file navigation and the DZR properties against the installed OBS version. Prefer replacement native screenshots captured during that test, with dummy/masked credentials and capture-version details added here.

## Assets

Each operating-system directory contains:

| File | Shows |
| --- | --- |
| `save-file.webp` | The permanent `Documents → DZR` folder and script; manual-download users must move the file here themselves |
| `tools-scripts.webp` | The OBS Tools menu with Scripts highlighted |
| `add-script.webp` | The **+** button below the scripts list |
| `select-file.webp` | Selecting `dzr-stream.lua` and clicking Open |
| `configure.webp` | The real DZR property names; example key shown only as masking dots |

All assets are 1280 × 760 pixels with a landscape aspect ratio. Their text uses DejaVu Sans and their palette follows DZR's dark background/red action accent. They are original vector artwork created for this repository; no third-party screenshot reproduction license is needed.

To regenerate a WebP after editing its SVG, use the root project's existing `sharp` dependency (no new package):

```sh
node -e 'const sharp = require("sharp"); sharp("public/streaming/setup/sources/windows-add-script.svg").webp({ quality: 90, effort: 6 }).toFile("public/streaming/setup/windows/add-script.webp")'
```

The same filename pattern applies to the other operating system and steps. Inspect the rendered image at the wizard's normal display width after regenerating.
