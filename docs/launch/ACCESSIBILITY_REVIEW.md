# Manual accessibility review

Automated Playwright/Axe checks cover the website login and the authenticated
overview, jobs, clients, inventory, documents, team, and settings routes. This
manual record is still required because automation cannot validate reading
order, speech quality, platform gestures, zoom usability, or device-specific
focus behavior.

Status: **NOT RUN**

Record the release SHA/build, browser or device/OS version, assistive technology
version, language, reviewer, UTC date, defects, retest evidence, and final
pass/fail decision. Test English, Hebrew RTL, and Arabic RTL where content is
available.

## Website keyboard and screen reader

- [ ] Skip link is first-focusable, visible, and moves focus to main content.
- [ ] Login, recovery, tenant selection, and every core navigation link work
      without a pointer.
- [ ] Focus order follows the visual/reading order and focus is never obscured.
- [ ] Modal focus enters the dialog, stays trapped, closes with Escape, restores
      to the invoker, and leaves the background inert and unscrollable.
- [ ] Forms expose programmatic names, required/invalid state, instructions,
      and announced error/success messages.
- [ ] Data tables announce headers correctly; icons and status colors have
      equivalent text.
- [ ] Dates, currency, and mixed-direction content are spoken and displayed
      correctly in English/Hebrew/Arabic.
- [ ] Content remains usable at 200% zoom and at narrow reflow widths without
      lost controls or two-dimensional scrolling for ordinary content.

## Mobile VoiceOver and TalkBack

Run the production-candidate iOS and Android binaries on supported physical
devices.

- [ ] Login, password visibility, recovery, and tenant selection have useful
      labels, hints, roles, states, and validation announcements.
- [ ] Primary/tab navigation exposes current selection and predictable focus.
- [ ] Shared inputs, selectors, date/time controls, photo/signature controls,
      and destructive confirmations are operable and announced.
- [ ] Alerts and modal sheets announce once, contain focus, close predictably,
      and restore focus.
- [ ] Assigned and solo job completion, including parts, photos, signature, and
      offline outcome, can be completed without sight.
- [ ] Pending Work announces queued/retry/conflict/terminal states and exposes
      deliberate retry/discard actions without relying on color.
- [ ] Dynamic Type/font scaling, landscape, tablet layout, light/dark mode, and
      RTL do not hide content or controls.

## Sign-off

| Field | Value |
|---|---|
| Result | `NOT RUN` |
| Reviewer |  |
| Devices/browsers |  |
| Defect links |  |
| Retest evidence |  |
| UTC approval |  |

