# dots native app icon

The selected artwork is **Ghost** from [IP as Logo](https://ipaslogo.com/), published by the linked project maintainer **s1dashu**. The inspected gallery did not identify an individual artist for this image.

- Original PNG: https://cdn.ipaslogo.com/logos/4ab06f6c35f5ab49-ghost-7.png
- Original file: `ghost-original.png` (1024 × 1024 RGB); its SHA-256 is recorded in `icon-manifest.json`.
- Permission basis, checked 2026-10-10: the live gallery permits free download and commercial use; its successfully read [official README](https://github.com/s1dashu/ip-as-logo-skill/blob/main/README.md) states, “Every logo is free for commercial use.”
- GitHub metadata identified [acb834c](https://github.com/s1dashu/ip-as-logo-skill/blob/acb834c717bcd0a487c49732d08397ba280d690b/README.md#L11) as the latest README change. The current README was read; that pinned version was not separately compared byte-for-byte.

The image is used under that commercial-use permission. It is not claimed to be MIT-licensed, exclusive to dots, independently trademark-cleared, or authored by this project. The repository's software license does not relicense this third-party artwork.

## Continuous-corner mask

`macos-style-mask.svg` is generated using [figma-squircle 1.1.0](https://github.com/phamfoo/figma-squircle/tree/45622dc2e9b23d69a44be673d15d1152c50df8d8), MIT © 2021 Tien Pham. The complete notice is retained in `LICENSE.figma-squircle` and included in local application bundles. Its parameters are recorded in `icon-manifest.json`: 824-pixel body, 100-pixel inset on a 1024 canvas, radius 184 and smoothing 0.6 with smoothing preserved.

This is a **macOS-style continuous-corner contour**, not an Apple template or a claim of exact system geometry. The artwork is rescaled and masked only; its composition, colors, silhouette and face are preserved. The native 1024-pixel output matches the selected preview pixel-for-pixel. The same approved artwork is used by the native icon, sidebar, empty state, favicon and secure-settings brand. The dots name and actual bot/user avatars retain their own meanings.

## Reproduction

The checked-in seven PNG sizes allow normal builds and macOS packaging without installing image-generation tools. The optional generator uses Sharp 0.35.4; `icon-manifest.json` records its rendering libraries and both PNG-byte and decoded-RGBA hashes. From the repository root:

```sh
npm install --prefix apps/lorca/icon-tools
node apps/lorca/scripts/render-icon.cjs
node apps/lorca/scripts/render-icon.cjs --check
```

The generator reads only the checked-in original and mask. It makes no downloads, model calls or image redesigns. Its check compares decoded pixels rather than platform-dependent PNG compression bytes. Different rendering-library builds can produce different edge pixels; use the recorded tool versions and inspect any mismatch rather than replacing the manifest blindly.

The packaged application includes the notice, mask license and manifest, but not the large original source artwork or optional image-generation toolchain.
