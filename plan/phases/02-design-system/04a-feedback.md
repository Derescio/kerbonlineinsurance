# 2.4a Feedback components

**Status:** done (split from 2.4 on 30 Oct 2026)
**Phase:** 02-design-system

## Goal

Port Alert, Dialog, Toast and Tooltip to typed TSX, adding the focus, keyboard and screen-reader behaviour the originals leave out, so later phases can confirm, warn and explain things in a way that works for everyone.

## In scope

Sources are `../components/feedback/*`; the CSS is already in `src/styles/components.css`. Each component keeps its Figma look; the changes are behaviour and semantics.

### Feedback (`src/components/feedback/`, Figma `4:9`)

| Component | What changes from the original |
|---|---|
| `Alert` (`11:105`) | The original gives every alert a live role (`alert` for danger, `status` otherwise), so an alert that's simply on the page when it loads gets announced as if it had just happened. New `announce` prop: off by default (no role, read in place). On when the alert appears after something the user did (danger → `alert`, others → `status`). `icon` takes `IconName`. |
| `Dialog` (`11:266`) | **Built on the native `<dialog>` with `showModal()`.** The browser then provides the focus trap (the rest of the page is inert), Escape (the `cancel` event), and focus going back to the button that opened it. Named by its title (`aria-labelledby`) and described by its description. Scrim click closes it when `onClose` is given; without `onClose`, Escape is blocked (non-dismissable). Page scroll is locked while it's open. `modal` and `sheet` presentations as before. `contained` (for `/system` previews) renders a non-modal copy inside its parent. |
| `Toast` (`11:173`) + `Toaster` | `Toast` stays presentational. **New `Toaster` + `useToast()`**: a live region that's always on the page (fixed bottom, `aria-live="polite"`; danger toasts go in an `assertive` one), because a live region added at the same moment as its message usually isn't announced. Toasts auto-dismiss after 5 s (the Figma page says so), pause while hovered or focused, and danger toasts stay until dismissed. Mounted once in `__root.tsx`. |
| `Tooltip` (`11:185`) | The original isn't linked to its trigger, and can't be dismissed without moving away (WCAG 1.4.13). Now the trigger is a `<button>` with `aria-describedby` → the bubble, and Escape hides the bubble until the next hover or focus. For jargon ("excess"), the term itself is the trigger. |

### Shared

- `.kb-sr-only` (visually hidden) utility in "App additions (2.4a)", plus the `<dialog>` resets and the scroll lock. 2.4b reuses `.kb-sr-only`.
- Icons needed (`circle-check`, `circle-alert`, `triangle-alert`, `info`, `x`) are already in the registry.

## Out of scope

- Navigation and insurance components ([2.4b](04b-nav-insurance.md)).
- A Menu / dropdown component (none in the design system).

## Sources

- `../components/feedback/*` (`.jsx`, `.d.ts`, `.prompt.md`), `feedback.card.html`.
- Figma Feedback `4:9` ([figma.md](../../figma.md)).
- WAI-ARIA APG: Dialog (Modal), Tooltip — https://www.w3.org/WAI/ARIA/apg/patterns/ · MDN `<dialog>` and `showModal()`.

## Files

- `src/components/feedback/{Alert,Dialog,Toast,Toaster,Tooltip}.tsx`, `feedback.browser.test.tsx`
- `src/styles/components.css` ("App additions (2.4a)")
- `src/routes/__root.tsx` (mount `Toaster`)

## Steps

- [x] `.kb-sr-only`, `<dialog>` resets and scroll lock.
- [x] `Alert`, `Tooltip` + tests.
- [x] `Toast` + `Toaster`/`useToast` + tests; mount `Toaster` in `__root.tsx`.
- [x] `Dialog` + tests.
- [x] Temporary page with every component and state next to Figma `4:9`; open the dialog and sheet (also at 390 px wide), fire toasts; no console errors. Put `/` back.
- [x] `vp check --fix`, `vp check`, `vp test`, `vp build`.

## Tests

| Layer | Test | Gate |
|---|---|---|
| Component | Alert: no live role by default; `announce` gives `alert` for danger and `status` otherwise; tone class and default icon per tone; title and action render | yes |
| Component | Dialog: opens as a modal named by its title and described by its description; focus moves inside; Tab stays inside; Escape and the close button call `onClose`; focus returns to the opener; scrim click closes; without `onClose` Escape does nothing; sheet has no close button | yes |
| Component | Toaster: `useToast()` shows a toast inside the polite region (assertive for danger); it auto-dismisses after the timeout (fake timers); danger stays; dismiss and action buttons work | yes |
| Component | Tooltip: trigger is described by the bubble; bubble shows on focus; Escape hides it; `placement="bottom"` class | yes |
| Manual | Every component and state next to Figma Feedback `4:9` | yes |
| Manual | Dialog and sheet look right on a 390 px wide viewport | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` exit with 0; `ci` green.
- [ ] Manual checks pass.

## Results (30 Oct 2026)

Changes from the spec:
- **Toast timeout is 5 s**, not 6 s: the Figma Feedback page says "toasts … auto-dismiss after 5s".
- **Dialog keeps itself in step with `open`.** Chrome lets a second Escape close a dialog even after the first `cancel` was prevented. The native `close` event therefore calls `onClose`, or reopens the dialog when there's no `onClose` (non-dismissable).
- **Dialog closes on `mousedown` on the scrim** (as the original did), so a text selection that starts in the panel and ends outside doesn't close it.

What was built:
- `src/components/feedback/{Alert,Tooltip,Toast,Toaster,Dialog}.tsx`. `toneIcons` and `FeedbackTone` are shared by Alert and Toast.
- `Toaster` wraps the app in `__root.tsx`; `useToast()` throws a clear error without it.
- `components.css` "App additions (2.4a)": `.kb-sr-only`; `<dialog>` as the full-screen scrim (hidden when closed, transparent `::backdrop`); `html:has(dialog.kb-dialog-scrim:modal)` scroll lock; Toaster stack; Tooltip trigger button and the Escape-dismissed state.
- `feedback.browser.test.tsx`: 15 tests (92 in total).
- Checked locally: 92/92 twice; `vp check` and `vp build` clean. A temporary page with every tone of Alert and Toast, both tooltip placements, the live modal (1300 px) and sheet (390 px), and a toast fired through `useToast()`: no console errors, and it matches Figma Feedback `4:9`. `/` was put back.

Known limit, not fixed: the tooltip bubble is centred on its trigger, so a term at the very edge of the viewport gets a clipped bubble (seen in the check, at the left edge). Fine for jargon inside body text; revisit if a screen puts one at an edge.

## Commit message

`feat: feedback components in TSX, on a native dialog and a toast live region`
