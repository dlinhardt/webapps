---
"surfannotate": patch
---

Draw border points and landmarks as sharp screen-space markers instead of blurred patches of mesh colour. They were painted as vertex labels over the clicked vertex and its 1-ring, which meant they were interpolated across the triangles, sized by the mesh rather than the screen, and wider than the vertex they marked — the reason they had to disappear once a region was filled. They are now projected onto their own canvas at a fixed size, each with a contrasting outline so it stays visible over any surface, overlay or ROI fill, and they stay put when the region is filled. Choose between a circle, a dot and a cross, in white, black, magenta or yellow; landmarks take the other shape. Markers on the far side of a closed surface are hidden rather than showing through it.
