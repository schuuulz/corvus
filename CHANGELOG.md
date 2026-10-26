# Changelog

## [0.5.0](https://github.com/schuuulz/corvus/compare/corvus-v0.4.1...corvus-v0.5.0) (2026-10-26)


### Features

* **graph:** anchor branch labels to the left of their column ([e9e9df8](https://github.com/schuuulz/corvus/commit/e9e9df84c81b5fcf9b925610e29beefde6885882))
* **graph:** commit graph hover, merge avatars and WIP line ([ffac7d0](https://github.com/schuuulz/corvus/commit/ffac7d071e7d3a9ff1ed2a9657996a9733e34bb5))
* **graph:** distinct, balanced lane colours ([0318e54](https://github.com/schuuulz/corvus/commit/0318e54f7f69a67781f3860d08ac00741651d715))
* **graph:** fade row bands until the row is selected ([0f018cc](https://github.com/schuuulz/corvus/commit/0f018cc9892b3bd14646571aed377caa091fe21f))
* **graph:** fold lanes one by one as the graph column narrows ([7fea5e8](https://github.com/schuuulz/corvus/commit/7fea5e8c11ffb433a65691274b8b9408b1014679))
* **graph:** hint the branch of unlabelled commits on hover ([9105319](https://github.com/schuuulz/corvus/commit/9105319351852f7eccf0adcf3f9d6e34bec56179))
* **graph:** hover rows like branches in the left panel ([55afde7](https://github.com/schuuulz/corvus/commit/55afde73b85eb5bfb3423ae64062b1e9e4ea7a2c))
* **graph:** lighter lane strokes ([cfc1f18](https://github.com/schuuulz/corvus/commit/cfc1f18744f9d59a66163ca5751927b2d3970be3))
* **graph:** link branch labels to their commit ([4253379](https://github.com/schuuulz/corvus/commit/42533797e69d0543dd44e3af1c09685bbb95024e))
* **graph:** show only the name in the author column ([191a891](https://github.com/schuuulz/corvus/commit/191a891bde5d2894999bb5b02e2767ac0bdbcbb9))
* **graph:** show the merger's avatar on merge commits ([e89a602](https://github.com/schuuulz/corvus/commit/e89a6022e854562313b50fc2ae2f98e0022d4c29))
* **graph:** style the hover branch hint like a branch label ([6e35c99](https://github.com/schuuulz/corvus/commit/6e35c9900b38454dc05fb30383f2305785a2e7f8))
* **graph:** thinner rings around commit avatars ([8e576f2](https://github.com/schuuulz/corvus/commit/8e576f21ab3b3a3a403f7c7346fe2da45e6ef05d))
* **graph:** tint each row's graph cell in its lane colour ([7bd791b](https://github.com/schuuulz/corvus/commit/7bd791b2d93234927f6e61626590575209b1f559))


### Bug Fixes

* **deps:** override dompurify to 3.4.17 ([6c8d714](https://github.com/schuuulz/corvus/commit/6c8d714a0d39c9499f4825273feb69621bea2cbf))
* **deps:** override dompurify to 3.4.17 ([ec82cc9](https://github.com/schuuulz/corvus/commit/ec82cc9fdd872835c9beb2d58438aa7fd6f83d3d))
* **deps:** update tokio to 1.54.1 ([2b95a2c](https://github.com/schuuulz/corvus/commit/2b95a2c243aef8d04c54df0362a58e0dea76a2cd))
* **deps:** update tokio to 1.54.1 ([b363889](https://github.com/schuuulz/corvus/commit/b3638891cd20191910c0efcf3d81eb3027fb4b9c))
* **git:** reject option-like arguments and paths outside the repo ([4ccde44](https://github.com/schuuulz/corvus/commit/4ccde44102faf81f19bb7e3761e516e931d5c8bf))
* **git:** reject option-like arguments and paths outside the repo ([eef9092](https://github.com/schuuulz/corvus/commit/eef9092a01ee88836678f8cedb05ff413a68fdd4))
* **graph:** connect the WIP node to HEAD across rows ([bdd1d85](https://github.com/schuuulz/corvus/commit/bdd1d85b846a458947d2c181e762fed235cd30cc))
* **graph:** draw label connectors as faint hairlines ([1b0c019](https://github.com/schuuulz/corvus/commit/1b0c0192bb2e6ebcd938dc89b28c4df1905c8543))
* **graph:** hover rows with the branch highlight, square edges ([dcb1aad](https://github.com/schuuulz/corvus/commit/dcb1aad6289e794ddfa1514c4b4894723db07c90))
* **graph:** keep converging lines visible up to their own column ([8161b5d](https://github.com/schuuulz/corvus/commit/8161b5dd447108ae4cf582de2be7bad92f80734c))
* **graph:** keep each line's colour along its whole column ([a1b5dd0](https://github.com/schuuulz/corvus/commit/a1b5dd015793ae76bffbf051b3fe31363a0a6354))
* **terminal:** never evaluate branch names in shell prompts ([8599b2d](https://github.com/schuuulz/corvus/commit/8599b2de6a8d05a9049035e3cbe22a079a3d9730))
* **terminal:** never evaluate branch names in shell prompts ([a26e61f](https://github.com/schuuulz/corvus/commit/a26e61f78d58fffc4bf0ab1f17dffe0a62314222))
* **ui:** blend the scrollbar corner into the background ([b7c4171](https://github.com/schuuulz/corvus/commit/b7c417187296913b55cd9ec5ff46f2ee46e244db))

## [0.4.1](https://github.com/schuuulz/corvus/compare/corvus-v0.4.0...corvus-v0.4.1) (2026-10-26)


### Bug Fixes

* **ci:** collect installers outside the vite dist directory ([c5e6466](https://github.com/schuuulz/corvus/commit/c5e64665dfcb51eb1c28d40860327f7d4cc017f3))

## [0.4.0](https://github.com/schuuulz/corvus/compare/corvus-v0.3.0...corvus-v0.4.0) (2026-10-23)


### Features

* **updater:** trusted releases and an animated auto-updater ([74f4c2b](https://github.com/schuuulz/corvus/commit/74f4c2b65f5adfa55b1fc06fcb4b702ace84ba78))
* **updater:** update automatically on launch, with a raven on the graph ([288436d](https://github.com/schuuulz/corvus/commit/288436d5a3fddf988281f4253315a8f1388a78d1))

## [0.3.0](https://github.com/schuuulz/corvus/compare/corvus-v0.2.0...corvus-v0.3.0) (2026-10-23)


### Features

* **graph:** highlight branch names in the pull request menu item ([6b0f92d](https://github.com/schuuulz/corvus/commit/6b0f92d3e9bc1e6ac3afea53b532ccb190a68ac7))
* **graph:** open pull requests from the branch menu ([1fb7ab2](https://github.com/schuuulz/corvus/commit/1fb7ab2bfdff13262237073b92db0e39ac3d44d8))
* **graph:** open pull requests from the branch menu ([0372c26](https://github.com/schuuulz/corvus/commit/0372c268bd7bd2f6cf966e8507d2e323789f7e40))
* **graph:** resizable columns, compact graph and one ref per row ([9043b7b](https://github.com/schuuulz/corvus/commit/9043b7bc09436b15360b89a343e2d4cfceb9a90e))
* **graph:** resizable columns, compact graph and one ref per row ([0ad3f87](https://github.com/schuuulz/corvus/commit/0ad3f87d3d22ec378aac2e2fd55095f471b8f9a1))
* open pull requests from the graph, resizable columns and a branch-aware terminal ([f1e4a7f](https://github.com/schuuulz/corvus/commit/f1e4a7f59e783549c0084fe2f3744cddcca2e28d))
* **terminal:** show the current branch in the prompt, in its graph colour ([f6c248c](https://github.com/schuuulz/corvus/commit/f6c248c2fa178e8919fb5025180db242c0309b0a))
* **terminal:** show the current branch in the prompt, in its graph colour ([27f58c5](https://github.com/schuuulz/corvus/commit/27f58c5237df1910b486b90ee161e1103204a565))
* **ui:** hide the browser menu and shortcuts in release builds ([fbad8f6](https://github.com/schuuulz/corvus/commit/fbad8f6dc3a13355ee893e4356a9660b527751c2))


### Bug Fixes

* **graph:** drop the trailing ellipsis from the pull request menu item ([2919937](https://github.com/schuuulz/corvus/commit/2919937a33f9d7e77784edc301058080fbc9b70e))
* **integrations:** accept a full URL as the self-hosted domain ([ccce08f](https://github.com/schuuulz/corvus/commit/ccce08fff0f98c02f7df68b7e1fdae41797c5b60))
* **pull:** fast-forward if possible by default ([3e83249](https://github.com/schuuulz/corvus/commit/3e8324947f6cb01e063d27773c04c894b59971d5))
* **ui:** keep context menus fully on screen ([569631e](https://github.com/schuuulz/corvus/commit/569631e6d59be1b099304b473cbe15e14b73a859))
* **ui:** open menus triggered by a click ([eaa8728](https://github.com/schuuulz/corvus/commit/eaa8728e4c353be3d918b53daf530eebc704b915))

## [0.2.0](https://github.com/schuuulz/corvus/compare/corvus-v0.1.1...corvus-v0.2.0) (2026-10-23)


### ⚠ BREAKING CHANGES

* the bundle identifier is now com.corvus.app, which moves the settings folder; settings and tokens are migrated on first launch.

### Features

* Corvus app icon and logo ([cd477ba](https://github.com/schuuulz/corvus/commit/cd477babbf1f270016abdf7bb75b8fcf21b398e9))
* initial release of kraken-craft ([7d35bda](https://github.com/schuuulz/corvus/commit/7d35bda6e88cd08e7b37c653d34b5b5878f7bb06))
* migrate settings, theme and keychain from kraken-craft ([0bab4a9](https://github.com/schuuulz/corvus/commit/0bab4a954bf1cca0dc6e1680cc9d3db8282c2a6a))
* rename app to Corvus ([3be9605](https://github.com/schuuulz/corvus/commit/3be96058e9b0db8ea3127d51f55830a4fea44c06))
* **ui:** emerald Corvus palette and theme ids ([e11d50a](https://github.com/schuuulz/corvus/commit/e11d50a88ae648f0f7a8500a3d402b76f0a97ad4))
* **ui:** Syne and Geist Mono typography ([ef54cd7](https://github.com/schuuulz/corvus/commit/ef54cd737194ebcbdaa7e404dff0eae7c81089b1))


### Bug Fixes

* **ui:** lighten the small Corvus logo ([a46cbda](https://github.com/schuuulz/corvus/commit/a46cbda65245a752dd66261ef433637c5e47c721))


### Documentation

* add project rules for Claude ([54aea4e](https://github.com/schuuulz/corvus/commit/54aea4ea0b51741a72f414ee3260824c6409856b))

## [0.1.1](https://github.com/schuuulz/kraken-craft/compare/kraken-craft-v0.1.0...kraken-craft-v0.1.1) (2026-10-21)


### Documentation

* add project rules for Claude ([54aea4e](https://github.com/schuuulz/kraken-craft/commit/54aea4ea0b51741a72f414ee3260824c6409856b))

## 0.1.0 (2026-10-21)


### Features

* initial release of kraken-craft ([7d35bda](https://github.com/schuuulz/kraken-craft/commit/7d35bda6e88cd08e7b37c653d34b5b5878f7bb06))
