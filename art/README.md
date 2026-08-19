# Source artwork

Full-resolution originals. **Not served** — `src/assets/` is copied wholesale
into the build, so a 1.7MB source left there ends up deployed even though no
page references it.

The banner crops in `src/assets/img/` are derived from `mnr-banner2.jpg`. The
method — measure ink per row, place the 3.5:1 window across both the landmark
and athlete bands, nudge below the ink maximum so no figure is clipped, then
emit a 2400px desktop and a 1400px phone crop at quality 70 — is written up in
`docs/DESIGN.md`. Re-run it if the artwork is replaced; do not reintroduce a
display-side crop.
