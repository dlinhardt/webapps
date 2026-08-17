---
"surfannotate": minor
---

Load a dropped file as the vertex mask when its name contains "mask". A mask is stored in the same formats as any overlay, so nothing in the bytes distinguishes the two and a dropped mask previously arrived as an overlay painted across the whole surface — it had to go through the "Choose a mask" picker instead. Names like `lh.V1.mask`, `lh.cortex_mask.gii` and `sub-01_desc-brainmask.nii.gz` are now routed to the mask; `lh.thickness.masked.gii` still loads as the overlay it is, and a surface keeps loading as a surface whatever it is called. The overlay picker is unchanged, so it remains the way to view a mask as data.
