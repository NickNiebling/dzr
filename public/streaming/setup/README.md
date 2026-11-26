# OBS setup illustrations

The Windows and macOS directories contain original DZR click illustrations. Each is marked “Illustration” and names the operating system it depicts. The SVG and PNG sources in `sources/` contain example paths and masked keys. The Linux guide reuses the Windows illustrations.

The shared `obs-add-script.webp` and `obs-remove-script.webp` illustrations use a Linux user's OBS screenshot as their reference. The add image shows an empty Scripts list and highlights **+**. The remove image highlights the neighboring remove button and shows a masked DZR key. It appears inside the expandable help for users who already have the script installed.

## UI references

- [Official OBS Scripting Guide](https://obsproject.com/kb/scripting-guide): Tools → Scripts, the scripts list on the left, editable properties on the right, and the **+** button below the list. Consulted 2026-11-08. The guide's illustrated OBS release and operating system are not identified; its discussion includes v26.1. No exact current OBS release is asserted by these illustrations.
- [DZR's distributed Lua script](../../../apps/bot/assets/dzr-stream.lua): the masked **DZR key** field is followed by **Test forbindelse**. The endpoint is built into the Lua file; there is no endpoint field or platform picker.
- The Windows file-placement illustration follows the familiar Windows 11 File Explorer layout, with its menus closed. The [user-provided File Explorer reference](https://www.easeus.com/images/en/data-recovery/drw-pro/show-hidden-items-downloads-folder.png) informed the requested layout; no pixels from that screenshot are distributed. Menu labels, window decoration, translations and theme can differ on the user's computer. `Documents / Dokumenter → DZR` is an example permanent location, not an assumed or automatically discovered filesystem path.

Authentic current Windows/macOS screenshots were not available in this Linux execution environment. These illustrations are the approved MVP fallback; they must not be described as native screenshots or evidence of a successful installation. Native acceptance testing remains required on Windows and macOS with official OBS Studio. Check Tools/Scripts, **+**, file navigation and the DZR properties against the installed OBS version. Prefer replacement native screenshots captured during that test, with dummy/masked credentials and capture-version details added here.

On both Windows and macOS, check **Gem DZR-script** in Chrome or Edge with a new browser profile. Confirm that Save As suggests Documents and `dzr-stream.lua`, that cancelling keeps the guide on step 2, and that saving lets you continue. Check **Download DZR-script** in Firefox or Safari where available. Move the file from the browser's download folder to a permanent location and confirm it in the guide. In both flows, open the folder you used in step 2 from OBS and select the saved file.

## Assets

Each operating-system directory contains:

| File | Shows |
| --- | --- |
| `save-file.webp` | An example permanent location in `Documents → DZR`, shown before saving or downloading the script |
| `tools-scripts.webp` | The OBS Tools menu with Scripts highlighted |
| `add-script.webp` | Previous illustration of the **+** button below the scripts list |
| `select-file.webp` | An example of selecting `dzr-stream.lua` and clicking Open. Use the folder and filename from step 2 |
| `configure.webp` | The real DZR property names; example key shown only as masking dots |

The Windows and macOS illustrations are 1280 × 760 pixels with DZR's dark background and red action accent. The Windows `save-file` illustration was regenerated with image generation on 2026-11-14. The Windows `select-file` illustration was regenerated on 2026-11-15 using the `save-file` image as its visual reference. Both `configure` illustrations were updated with image generation on 2026-11-17. The four illustrations have lossless PNG originals in `sources/`. The remaining six illustrations retain their SVG originals and DejaVu Sans text.

The Windows file-placement image shows a normal File Explorer window at `Documents → DZR`, a selected `dzr-stream.lua`, and no expanded menu. The matching file-selection image shows the same folder and file in a Windows-style Open dialog, with the filename field, Lua file filter and highlighted **Åbn** button. Both configuration images show the masked key and connection-test button. These generated illustrations support the guide; they do not document an actual Windows/macOS installation or connection test.

To regenerate a WebP after editing its SVG, use the root project's existing `sharp` dependency (no new package):

```sh
node -e 'const sharp = require("sharp"); sharp("public/streaming/setup/sources/windows-add-script.svg").webp({ quality: 90, effort: 6 }).toFile("public/streaming/setup/windows/add-script.webp")'
```

The same filename pattern applies to the other SVG-based illustrations. For the four PNG originals, resize during WebP encoding:

```sh
node -e 'const sharp = require("sharp"); sharp("public/streaming/setup/sources/windows-save-file.png").resize(1280, 760).webp({ quality: 90, effort: 6 }).toFile("public/streaming/setup/windows/save-file.webp")'
```

Inspect the rendered image at the wizard's normal display width after regenerating.
