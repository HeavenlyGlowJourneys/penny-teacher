# Third-party notices

Original code and materials that Heavenly Glow Journeys (Pty) Ltd has the legal right to license are covered by the MIT License in `LICENSE`.

This file records third-party code and assets that are copied into the repository, installed from `package.json` / `bun.lock`, or loaded by the application. Those components are not licensed under the project MIT License and are not claimed as property of Heavenly Glow Journeys (Pty) Ltd.

Versions and license identifiers below were checked against installed package metadata and license files in `node_modules` at lockfile commit `602697a` plus the later type-only correction. `node_modules` is not part of the git tree. The same packages are installed from `bun.lock` and some of them are bundled into a production build.

This notice is not an exhaustive list of every transitive package. Permissive packages that are only build tools, and whose license text already travels inside the installed package, are summarised at the end. Optional platform packages that were not installed on the machine used for this review are listed as unverified.

## Copied into this repository

### shadcn/ui-style components

`src/components/ui/`, `src/lib/utils.ts`, and `src/hooks/use-mobile.tsx` follow the shadcn/ui new-york pattern declared in `components.json` (`https://ui.shadcn.com/schema.json`). The files have been adapted and do not include an upstream copyright header. They were not compared line by line with the upstream repository.

The upstream license fetched from `https://raw.githubusercontent.com/shadcn-ui/ui/master/LICENSE.md` is the MIT License:

```
Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

Those local files also import separately licensed packages, including Radix UI, `cmdk`, `vaul`, `embla-carousel-react`, `react-day-picker`, `recharts`, `input-otp`, `react-resizable-panels`, `sonner`, `class-variance-authority`, and `lucide-react`. Those packages stay under their own licenses.

## Distributed with the application

These packages are imported by application source and can be included in a build.

### JSZip 3.10.1

`package.json` license: `(MIT OR GPL-3.0-or-later)`.

`node_modules/jszip/LICENSE.markdown` states that JSZip is dual licensed and may be used, at the user's choice, under the MIT License or GPLv3. This project uses the MIT option. The GPL text in that file is the alternative license, not an additional grant.

```
Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso
```

The MIT permission notice in that file must be retained with copies or substantial portions of JSZip.

Used from `src/features/oral-assessment/utils/extract-document.ts` and `src/features/prep-check/`.

### pako 1.0.11

Installed with JSZip. `package.json` license: `(MIT AND Zlib)`.

MIT notice in `node_modules/pako/LICENSE`:

```
Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn
```

Zlib-style notice in `node_modules/pako/lib/zlib/constants.js`:

```
(C) 1995-2013 Jean-loup Gailly and Mark Adler
(C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
```

Both notices apply. The zlib header requires that the origin of the software not be misrepresented and that altered versions be marked as such.

### SheetJS `xlsx` 0.20.3

`package.json` license: `Apache-2.0`. The installed `LICENSE` file is the Apache License, Version 2.0. Its appendix identifies:

```
Copyright (C) 2012-present   SheetJS LLC
```

Apache License 2.0 notice and attribution requirements apply to copies of this library, including a production bundle. Used from `src/lib/export.ts` and several mark-import and report routes.

### PDF.js `pdfjs-dist` 6.2.108

`package.json` license: `Apache-2.0`. The installed `LICENSE` file is the Apache License, Version 2.0. The package describes itself as a build of Mozilla's PDF.js. Used from `src/features/oral-assessment/utils/extract-document.ts`.

### Mammoth 1.12.0

`package.json` license: `BSD-2-Clause`. `node_modules/mammoth/LICENSE`:

```
Copyright (c) 2013, Michael Williamson
All rights reserved.
```

Redistribution in source or binary form must keep that copyright notice, the license conditions, and the disclaimer. Used to read DOCX files.

### duck 0.1.12

Transitive dependency of Mammoth. `package.json` license field is `BSD`. The installed `LICENSE` text is the two-clause BSD form, not the four-clause BSD license:

```
Copyright (c) 2013, Michael Williamson
```

Source and binary redistributions must retain that notice and the disclaimer.

### Radix UI

The direct `@radix-ui/react-*` packages locked in `bun.lock` and installed for this app declare `MIT` in `package.json` and ship a license file:

```
Copyright (c) 2022 WorkOS
```

The MIT notice must be retained with those packages. They are used by the local UI components. This is separate from the shadcn/ui notice above.

### Lucide `lucide-react` 0.575.0

`package.json` license: `ISC`. `node_modules/lucide-react/LICENSE` includes:

```
Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2026 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2026.
```

The Feather-derived portions are additionally under the MIT License, Copyright (c) 2013-2026 Cole Bemis. Icons are imported throughout the application. The icon files are not copied into `src/`.

### Other direct runtime libraries

These direct dependencies declare permissive licenses in installed `package.json` metadata, with a license file unless noted. Their own notices stay with the packages and are not restated in full here:

| Package | Locked version | License | Notice found in the install |
|---|---|---|---|
| `react`, `react-dom` | 19.2.5 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `@supabase/supabase-js` | 2.109.0 | MIT | Copyright (c) 2020 Supabase |
| `@tanstack/react-query` | 5.100.1 | MIT | Copyright (c) 2021-present Tanner Linsley |
| `@tanstack/react-router` | 1.168.25 | MIT | Copyright (c) 2021-present Tanner Linsley |
| `@tanstack/react-start` | 1.167.28 | MIT | Copyright (c) 2021-present Tanner Linsley |
| `react-hook-form` | 7.73.1 | MIT | Copyright (c) 2019-present Beier (Bill) Luo |
| `@hookform/resolvers` | 5.2.2 | MIT | Copyright (c) 2019-present Beier (Bill) Luo |
| `zod` | 3.25.76 | MIT | Copyright (c) 2025 Colin McDonnell |
| `clsx` | 2.1.1 | MIT | Copyright (c) Luke Edwards |
| `tailwind-merge` | 3.5.0 | MIT | Copyright (c) 2021 Dany Castillo |
| `tailwindcss` | 4.2.4 | MIT | Copyright (c) Tailwind Labs, Inc. |
| `@tailwindcss/vite` | 4.2.4 | MIT | Copyright (c) Tailwind Labs, Inc. |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | Apache License 2.0 |
| `cmdk` | 1.1.1 | MIT | Copyright (c) 2022 Paco Coursey |
| `date-fns` | 4.1.0 | MIT | Copyright (c) 2021 Sasha Koss and Lesha Koss |
| `embla-carousel-react` | 8.6.0 | MIT | `package.json` only. Author: David Jerleke. No license file in the install |
| `input-otp` | 1.4.2 | MIT | `package.json` only. Author: Guilherme Rodz. No license file in the install |
| `react-day-picker` | 9.14.0 | MIT | Copyright (c) 2014-2025 Giampaolo Bellavite and contributors |
| `react-resizable-panels` | 4.10.0 | MIT | Copyright (c) 2018 Brian Vaughn |
| `recharts` | 2.15.4 | MIT | Copyright (c) 2015-present recharts |
| `sonner` | 2.0.7 | MIT | Copyright (c) 2023 Emil Kowalski |
| `vaul` | 1.1.2 | MIT | Copyright (c) 2023 Emil Kowalski |
| `tw-animate-css` | 1.4.0 | MIT | Copyright (c) 2025 Wombosvideo |
| `@react-email/components` | 1.0.12 | MIT | Copyright 2024 Plus Five Five, Inc |
| `react-email` | 6.6.5 | MIT | Copyright 2024 Plus Five Five, Inc |

`victory-vendor` 36.9.2 is installed with Recharts. Its `package.json` license is `MIT AND ISC`. The install contains no separate license file.

## Build tools that stay under their own licenses

These are not application source. They are installed from the lockfile and used to build or check the project.

### Lightning CSS 1.32.0

`lightningcss` and the installed `lightningcss-win32-x64-msvc@1.32.0` binary declare `MPL-2.0`. The installed `LICENSE` is the Mozilla Public License, Version 2.0. A search of the installed JavaScript did not find an "Incompatible With Secondary Licenses" notice attached to the code.

MPL-2.0 obligations stay on the Lightning CSS files. They are not relicensed by the project MIT License. Lightning CSS is pulled in by `@lovable.dev/vite-tanstack-config`.

Other `lightningcss-*` platform binaries are listed in `bun.lock` but were not installed on this Windows machine. Their license files were not read. Do not assume they match the Windows binary without checking those packages.

### caniuse-lite 1.0.30001790

`package.json` license: `CC-BY-4.0`. The installed `LICENSE` is Creative Commons Attribution 4.0 International. Author metadata: Ben Briggs. This is browserslist data used at build time. Redistribution of that data requires CC-BY-4.0 attribution.

### Lovable development packages

These declare `MIT` in `package.json` and do not ship a `LICENSE` file in the installed package:

| Package | Version |
|---|---|
| `@lovable.dev/vite-tanstack-config` | 2.7.1 |
| `@lovable.dev/vite-plugin-dev-server-bridge` | 1.0.2 |
| `@lovable.dev/vite-plugin-hmr-gate` | 1.1.1 |
| `lovable-tagger` | 1.2.0 |

`lovable-tagger` names Emil Fagerholm as author. The MIT claim is the `package.json` field only.

### Other direct development dependencies

| Package | Locked version | License | Notice found in the install |
|---|---|---|---|
| `vite` | 8.0.16 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors |
| `@vitejs/plugin-react` | 5.2.0 | MIT | Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors |
| `vite-tsconfig-paths` | 6.1.1 | MIT | Copyright (c) Alec Larson |
| `@tanstack/router-plugin` | 1.167.28 | MIT | Copyright (c) 2021-present Tanner Linsley |
| `nitro` | 3.0.260603-beta | MIT | Copyright (c) Pooya Parsa and Nitro contributors |
| `typescript` | 5.9.3 | Apache-2.0 | Apache License 2.0 |
| `typescript-eslint` | 8.59.0 | MIT | Copyright (c) 2019 typescript-eslint and other contributors |
| `eslint` | 9.39.4 | MIT | Copyright OpenJS Foundation and other contributors |
| `@eslint/js` | 9.39.4 | MIT | Copyright OpenJS Foundation and other contributors |
| `eslint-config-prettier` | 10.1.8 | MIT | Copyright (c) 2017-2023 Simon Lydell and contributors |
| `eslint-plugin-prettier` | 5.5.5 | MIT | Copyright (c) 2017 Andres Suarez and Teddy Katz |
| `eslint-plugin-react-hooks` | 5.2.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `eslint-plugin-react-refresh` | 0.4.26 | MIT | Copyright (c) Arnaud Barré |
| `prettier` | 3.8.3 | MIT | Copyright (c) James Long and contributors |
| `globals` | 15.15.0 | MIT | Copyright (c) Sindre Sorhus |
| `@types/node` | 22.19.17 | MIT | Copyright (c) Microsoft Corporation. |
| `@types/react` | 19.2.14 | MIT | Copyright (c) Microsoft Corporation. |
| `@types/react-dom` | 19.2.3 | MIT | Copyright (c) Microsoft Corporation. |

## Fonts loaded remotely

`src/routes/__root.tsx` loads Fraunces and Plus Jakarta Sans from `fonts.googleapis.com`. Those font files are not stored in this repository, and their license texts are not in the tree. Email templates name Plus Jakarta Sans as a CSS `font-family` only. Review the font authors' licenses before redistributing the font files themselves.

## Items still requiring review

- About 187 lockfile entries are optional native packages for other operating systems, including other `@esbuild/*`, `@oxc-parser/binding-*`, `@rolldown/binding-*`, `@tailwindcss/oxide-*`, and non-Windows `lightningcss-*` builds. They were not installed here, so their license files were not verified.
- `argparse@2.0.1`, nested under `js-yaml`, declares `Python-2.0` in `package.json` and has no license file. Its source header says Copyright (C) 2010-2020 Python Software Foundation and Copyright (C) 2020 argparse.js authors. The Python Software Foundation license text is not in the package. A separate `argparse@1.0.10` is MIT.
- `embla-carousel-react` and `input-otp` declare MIT without shipping a license file.
- The Lovable packages above declare MIT without shipping a license file.
- `victory-vendor@36.9.2` declares `MIT AND ISC` without a license file.
- Generated files `src/integrations/supabase/client.ts`, `client.server.ts`, `auth-middleware.ts`, and `auth-attacher.ts` say they are automatically generated but name no copyright owner. `src/routeTree.gen.ts` says it was generated by TanStack Router. TanStack Router's own package is MIT. The copyright in the generated project files is not stated in those files.
- Brand images in `public/` have no separate license notice. They are covered by the project MIT License only to the extent Heavenly Glow Journeys (Pty) Ltd owns them and has the right to license them. This repository does not itself prove that ownership.
- Service terms for Lovable, Claude, and Cursor are not in the repository. Those terms still need to be checked against the accounts used to produce generated code before treating every generated file as covered by the project MIT License.
