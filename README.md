# AQUA

This fork modernizes AQUA and includes **Band Pass (BP)** filtering plus
gain-enabled **BP EQ, LP EQ, and HP EQ** modes (1.3.0 builds). Download the
`AQUA-Windows-x64` artifact from a successful [Test workflow run](https://github.com/AndreiShenets/AQUA/actions/workflows/test.yml),
or [build it locally](#development-prerequisites). The [upstream 1.1.1 installer](https://github.com/h39s/AQUA/releases/latest/download/AQUAsetup.exe)
is the legacy version and does not include BP. The fork's published **1.2.0**
release includes pass-only BP, but not the new EQ modes.

Welcome to AQUA, a modern platform for audio equalization on Windows. Please note that EqualizerAPO is a prerequisite for our application. Our current features include

- System-wide parametric audio equalization (through [EqualizerAPO](https://sourceforge.net/projects/equalizerapo/))
- AutoEQ integration (credit to [Jaakko Pasanen](https://github.com/jaakkopasanen/AutoEq/tree/master/results) and [Ian Walton](https://github.com/iwalton3/AutoEq) for their preset results for the Harman, IEF, and IEF with bass targets)
- Auto Pre-amp Gain based on the plotted response (up to 30 dB attenuation; not a limiter)
- Saving/loading equalizer presets
- Graph visualizer for equalizer settings (between 10 Hz and 20 KHz)
- Up to 20 filters (+ preamp gain) with adjustable
  - Filter type (peak, low/high shelf, low/high pass, notch, **band pass / BP**, or **BP EQ / LP EQ / HP EQ**)
  - Centre frequency (1 Hz - 20 KHz)
  - Gain (-30dB to 30dB)
  - Quality (0.01 - 100.00)

**Upstream development notice:** AQUA's original developers have paused development.
Their [upstream repository](https://github.com/h39s/AQUA) and [contact email](mailto:aqua.devteam@gmail.com)
remain available. The toolchain and BP fixes documented here belong to this fork.

![image](https://user-images.githubusercontent.com/20293445/222267346-b0e2064d-92c2-4334-9bff-d638f9535d12.png)

## Getting Started

To get started using AQUA, it only takes two easy steps:

1. Install [EqualizerAPO](https://sourceforge.net/projects/equalizerapo/) if you don't have it currently installed (and make sure you run `configurator.exe` included as a part of EqualizerAPO to install the required drivers for the devices you would like to EQ).
2. Download and extract `AQUA-Windows-x64` from a successful [workflow run](https://github.com/AndreiShenets/AQUA/actions/workflows/test.yml) for the version you want, then run its `AQUA Setup <version>.exe`. Back up your settings first when replacing an existing installation; see [Try filters safely](#try-filters-safely).

## FAQ

### Import AQUA presets

In **1.4.0**, drop one or more AQUA preset files directly onto the list in
**Preset Menu**, or click **Open** beside **Load selected preset**. Import results
and rejection messages appear below those buttons; there is no separate import
bar. Messages clear when you change the preset selection/name, load, save, remove,
or rename a preset. Both `.json` and AQUA's extensionless preset files are supported.
The filename becomes the preset name (a final `.json` is removed).

Valid presets are saved under `%APPDATA%\aqua\presets` and appear in the menu
immediately. Importing does **not** select a preset or change the active EQ/APO
configuration; select it and use **Load selected preset** when ready.

- Current filter-map and legacy filter-array presets are supported. AQUA state
  JSON can also be imported, but only its preamp and filters are retained.
- JSON structure, supported types, finite numeric values, frequency/gain/Q bounds,
  1–20 filters, filter IDs, and safe filenames are checked before saving.
- Existing names, including case-only matches, are rejected without overwriting.
  Rename the source file to import a separate copy.
- Each file gets an import result. Invalid files are rejected; other valid files
  in the same batch can still be imported. Limit: 20 files per batch, 256 KiB each.
- Poweramp exports and Equalizer APO text configurations are **not** AQUA preset
  files; convert them first. Merely renaming a file to `.json` does not convert it.

### Case-sensitive preset names

By default, the Windows file system does not support case sensitive file names (i.e. you cannot have files/folders named `AQUA` and `aqua` in the same directory).

- On Windows 11, AQUA is able to enable case sensitivity specifically for our `presets` folder so users can save presets with case-sensitive names.
- On Windows 10, if you would like to enable this feature you will have to install [WSL](https://learn.microsoft.com/en-us/windows/wsl/). You can do so by opening a PowerShell window as an administrator and running `wsl --install`.
  - If you have existing presets saved in AQUA, you will need to temporarily empty the presets folder (`C:\Users\<username>\AppData\Roaming\aqua\presets`) before starting the app to enable case sensitivity. Your existing presets can then be copied back into the presets folder.
- On Windows 7, 8, and 8.1, case sensitive preset naming is not available.

## Get In Touch

If you find any bugs, have any feature requests, or want to give us any kind of feedback, we'd love to hear it! Please feel free to reach out to us via [email](mailto:aqua.devteam@gmail.com)!

## Development Prerequisites

- Windows 10/11 **64-bit**; Equalizer APO is needed for live system audio.
- Node.js **24 LTS** recommended (minimum 22.12), npm 10 or newer.
- Visual Studio C++ Build Tools are only needed if a native dependency has no prebuilt binary.

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit -- --runInBand
npm run package -- --win --x64
npm run test:smoke
```

The installer and unpacked application are written to `release/build/`. Builds
without a signing certificate are unsigned; Windows may show a SmartScreen warning.
Packaging does not install AQUA or modify your audio configuration.

### Modern toolchain

This fork uses Electron **45.2.1**, React **19**, and TypeScript **7.0.2**.
ChromeDriver is downloaded from the exact pinned Electron release using Electron's
current checksum-verifying downloader and native ZIP extractor (the old
`electron-chromedriver` wrapper uses an obsolete extractor). Node typings follow Electron's
embedded Node.js 24 rather than the newer Node.js used on some developer machines.

TypeScript 7 checks all application, test, and build-configuration types through
`npm run typecheck`. `tsx` runs build scripts, `esbuild-loader` transpiles webpack
inputs, SWC transforms Jest tests, and Oxlint replaces the legacy ESLint presets.
These tools do not depend on TypeScript's removed JavaScript compiler API. React
Compiler-specific lint rules are disabled because this project does not use React
Compiler; existing semantic-button accessibility suggestions remain warnings.
`skipLibCheck` avoids conflicting upstream DOM/URLPattern and native-library
declarations; application and test type-checking remains strict.

On npm 12+, the reviewed binary-install scripts are explicitly approved in
`package.json`. Unneeded browser-driver and optional/fallback scripts are not
blanket-approved. New dependency versions may need a fresh script review.

`npm audit --omit=dev` checks runtime dependencies. Development-tool dependencies
may still have upstream advisories even at their latest releases; do not use
`npm audit fix --force` to silently downgrade the modern toolchain.

### Gain-enabled pass EQ (1.3.0)

Choose **Band Pass EQ**, **Low Pass EQ**, or **High Pass EQ** in the filter
dropdown. Each supports frequency, Q, and gain. Existing **Band Pass Filter**,
**Low Pass Filter**, and **High Pass Filter** remain pass-only, with gain disabled.

Each EQ stage mixes a filtered branch with its original input:

```text
output = input + (10^(gain_dB / 20) - 1) * pass_filter(input)
```

- **BP EQ:** gain is the response at the center frequency; both ends stay at 0 dB.
- **LP EQ:** gain is the low-frequency limit; the high-frequency limit stays at 0 dB.
- **HP EQ:** gain is the high-frequency limit; the low-frequency limit stays at 0 dB.
- **0 dB gain:** exact bypass for all three modes. Multiple EQ bands are cascaded;
  their wet branches are not all mixed with one shared original signal.

LP/HP dry/wet phase interaction can produce peaks and dips near cutoff, especially
at high Q. These modes are not ordinary shelves, and negative gain does not
guarantee attenuation at every frequency. The graph includes that phase interaction
but uses a fixed 96 kHz design rate; APO uses the device's actual sample rate.
Leave headroom: auto preamp uses sampled graph points and stops at -30 dB, so it
cannot guarantee clipping prevention with sharp resonances or many boosted bands.
Exact Poweramp matching is not claimed.

Export uses Equalizer APO's [custom IIR and expression support](https://sourceforge.net/p/equalizerapo/wiki/Configuration%20reference/),
as in its [sample-rate-aware IIR example](https://github.com/mirror/equalizerapo/blob/master/Setup/config/iir_lowpass.txt).
It applies to all channels without virtual-channel routing. The design frequency
is clamped to 0.499 times the device sample rate if necessary. Presets retain the
new types; older AQUA versions do not support them, so keep a backup before downgrading.

### Try filters safely

To run the unpacked application without changing live presets or APO files:

```powershell
& '.\release\build\win-unpacked\AQUA.exe' --aqua-sandbox=C:\Temp\aqua-preview
```

The sandbox stores settings/presets under `user-data/` and simulated APO output
under `config/` in that directory. It does **not** change system audio, enable
case-sensitive directories, or check for updates. `npm run test:smoke` creates
and cleans up its own hidden sandbox and tests the packaged application through
ChromeDriver, including legacy BP, all three EQ types, gain edits, generated IIR
output, drop import with invalid/duplicate rejection, unchanged active settings,
and persistence after restarting. It never changes live APO configuration.

In the filter dropdown choose the green **Band Pass Filter** icon. Set its center
frequency and Q; gain is intentionally disabled. BP attenuates frequencies outside
the pass band. Saved presets and settings now accept all supported filter types.

Before using the new build against live audio, close the old AQUA and back up
`%APPDATA%\aqua` and your Equalizer APO `config` directory. Launching without
`--aqua-sandbox` uses the normal AQUA settings and live APO integration. This
fork's updater points to `AndreiShenets/AQUA`, not upstream releases.

## License

AQUA: System-wide parametric audio equalizer interface

Copyright (C) 2023 AQUA Dev Team

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
