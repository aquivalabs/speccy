#!/usr/bin/env bash
# Speccy banner — ZX Spectrum rainbow flash + wordmark.
# Kept to two lines: Claude Code's Bash output preview folds everything past
# the first three lines, so a taller banner is truncated on screen.
R=$'\033[91m'; Y=$'\033[93m'; G=$'\033[92m'; B=$'\033[94m'; X=$'\033[0m'; D=$'\033[2m'; BD=$'\033[1m'
printf "%s\n" \
"  ${R}██${Y}██${G}██${B}██${X}  ${BD}SPECCY${X}   ${D}Think before you build... Then keep thinking${X}" \
"  ${D}spec → critique → plan → build → review${X}"