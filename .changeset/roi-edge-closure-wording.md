---
"surfannotate": patch
---

Name the edge-closure button after the edge that exists. A finished ROI's rim already closed a region exactly as a flat patch's cut does, but the button and its hint only ever described the flat-patch case — so on a whole hemisphere, where there is no visible edge, the feature read as inapplicable at the moment it was the right tool. It now reads "Close on ROI edge" when a saved ROI is what you can close against, and clicking inside a saved ROI leads with that option instead of only offering to reorder or reopen the list.
