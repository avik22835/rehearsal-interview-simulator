# Interview Simulator design system

## Scene and theme

A student sits with a laptop in a normally lit room for a long afternoon study
session; neutral black and charcoal surfaces and pale text keep the workspace calm.
Black is the application default across all screens. A top-bar sun/moon toggle
switches the whole interface to light or dark and persists the choice locally. Use a muted mint accent for
active selection and primary actions, with dark text on filled accent buttons.

## Typography

Segoe UI/system sans for application controls and body; Georgia for the welcome
headline only, giving the study launcher a thoughtful character. Body copy at
14–16 px, conversation at 17 px/1.7, headings at 24–36 px. Maximum prose width 72ch.

## Color and surfaces

Shared CSS tokens define a neutral black canvas (#0b0b0b), dark work surface
(#141414), sidebar (#101010), raised surface (#202020), pale text (#ededed),
and mint accent (#9bcbaa). Secondary text stays readable against dark surfaces.
Use thin neutral separators and sparse shadows; no decorative gradients or glass
panels. Native inputs, scrollbars, selection, browser theme metadata and Electron
window chrome follow the selected theme. Large dark surfaces are neutral grey;
green is limited to small accents. The light theme uses neutral white/grey surfaces. Monaco keeps its dark syntax theme by default.
Success, warning, and error use distinct labels and icons as well as color.

## Layout

232 px sidebar, fluid main area, generous 40–56 px desktop inset. Workspace
conversation uses a single readable column plus a quiet context panel. Launcher
modes are a numbered editorial list with descriptions and clear selection.
Sidebar collapses on small screens; forms stack and actions remain reachable.

## Components and motion

Primary evergreen pill/rounded buttons, subtle neutral secondary buttons,
12–16 px surface radii, 1 px dividers. Inputs have labels, focus rings, useful
empty/error states, and consistent padding. State transitions use opacity or
transform for 160–200 ms; honor prefers-reduced-motion. No decorative autoplay.
