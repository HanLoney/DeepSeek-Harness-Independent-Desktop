# Provenance of `widget/assets/`

## License boundary — read before publishing

Every file in `widget/assets/` is **excluded from this repository's MIT license**. They come from the upstream `dsh-whale-widget` project, whose `PROVENANCE.md` states that its images, animations, and sound effects are provided as-is, that it claims no originality over them, that it grants no sublicense, and that it honors takedown requests.

They were adopted here for personal, local use. **If this repository is published under MIT, `widget/assets/` must not be part of the release**, or each asset needs separate redistribution rights first. Deleting `apps/desktop/widget/` (see `README.md`) removes every asset with it.

## Files

| File | Kind | Role in the widget |
|---|---|---|
| `DSniang1.png` | image | Idle and working whale. |
| `DSniang02.png` | image | Thinking whale. |
| `bubble-petpet.gif` | animation | Petted-whale celebration on a completed turn. |
| `DSH2.png` | image | Banner wash behind the bubble header. |
| `bubble-money1.gif` | animation | Coin marking the token figure. |
| `rua.gif` | animation | Byte-identical to `bubble-petpet.gif`; retained because the upstream set contains both names. |
| `Ya1.mp3`, `Ya2.mp3` | sound | Turn start; sound toggle. |
| `D1.mp3`, `D2.mp3` | sound | Tool call; turn failure. |
| `minecraft-exp-orb.wav` | sound | Todo list completed. |
| `task-end-a.wav` | sound | Goal round completed. |

No asset has been edited, converted, or renamed. Every file above except `rua.gif` is referenced by `renderer.js`; `rua.gif` is byte-identical to `bubble-petpet.gif`, so the renderer uses the latter and the duplicate is retained only to keep the upstream set complete.
