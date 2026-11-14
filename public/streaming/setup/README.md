# OBS setup illustrations

The ten WebP assets are original DZR **click illustrations**, not screenshots. Every image is visibly marked “Illustration” and names Windows or macOS. The SVG and PNG sources in `sources/` are the originals. They contain no credentials, real user paths or copied screenshot pixels.

## UI references

- [Official OBS Scripting Guide](https://obsproject.com/kb/scripting-guide): Tools → Scripts, the scripts list on the left, editable properties on the right, and the **+** button below the list. Consulted 2026-11-08. The guide's illustrated OBS release and operating system are not identified; its discussion includes v26.1. No exact current OBS release is asserted by these illustrations.
- [DZR's distributed Lua script](../../../apps/bot/assets/dzr-stream.lua): the actual fields are **DZR key** and the optional **YouTube-videolink**, followed by **Test forbindelse**. The key field is masked. The endpoint is built into the Lua file; there is no endpoint field or platform picker.
- The Windows file-placement illustration follows the familiar Windows 11 File Explorer layout, with its menus closed. The [user-provided File Explorer reference](https://www.easeus.com/images/en/data-recovery/drw-pro/show-hidden-items-downloads-folder.png) informed the requested layout; no pixels from that screenshot are distributed. Menu labels, window decoration, translations and theme can differ on the user's computer. `Documents / Dokumenter → DZR` is an example permanent location, not an assumed or automatically discovered filesystem path.

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

All served assets are 1280 × 760 pixels with a landscape aspect ratio and DZR's dark background/red action accent. The Windows `save-file` illustration and both `configure` illustrations were regenerated with image generation on 2026-11-14. Their lossless PNG originals are stored in `sources/`; the older, superseded SVGs were removed. The remaining seven illustrations retain their SVG originals and DejaVu Sans text. No third-party screenshot pixels are distributed.

The Windows file-placement image shows a normal File Explorer window at `Documents → DZR`, a selected `dzr-stream.lua`, and no expanded menu. Both configuration images show only the masked key, optional YouTube link and connection-test button. These generated illustrations support the guide; they do not document an actual Windows/macOS installation or connection test.

To regenerate a WebP after editing its SVG, use the root project's existing `sharp` dependency (no new package):

```sh
node -e 'const sharp = require("sharp"); sharp("public/streaming/setup/sources/windows-add-script.svg").webp({ quality: 90, effort: 6 }).toFile("public/streaming/setup/windows/add-script.webp")'
```

The same filename pattern applies to the other SVG-based illustrations. For the three PNG originals, resize during WebP encoding:

```sh
node -e 'const sharp = require("sharp"); sharp("public/streaming/setup/sources/windows-save-file.png").resize(1280, 760).webp({ quality: 90, effort: 6 }).toFile("public/streaming/setup/windows/save-file.webp")'
```

Inspect the rendered image at the wizard's normal display width after regenerating.
