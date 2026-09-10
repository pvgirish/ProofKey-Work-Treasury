# Participant app visual inspection

Reviewed the local rebuilt app on desktop and phone widths. The six PNGs in this directory cover Program, My work and Paid work at 1440×1000 and 390×844. These images show the ordinary empty/read-only state; they do not depict an outside participant or settlement. The QA capture measured document/body/view widths and found no horizontal overflow.

Manual inspection confirmed readable headings and form labels, stacked phone controls, visible disabled actions before work is loaded, distinct WORK/FEE history totals, and accessible saved-work/milestone selectors. The source transaction journal and exact-payment inspector use the same continuing-work panel; functional behavior is covered separately by regression and review.

A separate in-app browser inspection read the public 120-CTC epoch. The final board showed 55 earned and 65 returned, without clipped labels for the zero available/reserved portions. It showed the closed phase and refused follow-up creation. Paid totals stayed “Not collected for this epoch” until a matching closeout was collected; reading source accounting alone did not create a verified paid-history result.

The manually observed historical-RPC failure and incomplete payment-history result are documented in `public-readback-notes.md`. Browser evidence fixtures are disclosed in the test log. No real wallet or broadcast was used for these visual checks.
