#!/usr/bin/env python3
"""Extract generated Wayfinder Arsenal contact sheets into normalized WebPs.

The image model renders a light checkerboard into its RGB output even when
asked for transparency. This script removes that neutral high-value backdrop,
crops each semantic cell, and normalizes the surviving silhouette to 128px.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


ITEM_SHEET_A = [
    ["initiates-edge", "frontier-warhammer", "black-star-crescent", "pulse-sidearm", "vanguard-repeater"],
    ["ironshot-carbine", "reedline-bow", "watcher-crossbow", "stormlance", "frontier-bow", "ember-focus"],
    ["tide-scepter", "void-grimoire", "iron-blade", "scout-helm"],
]

ITEM_SHEET_B = [
    "sunbreak-pistol", "plated-vest", "warden-helm", "citadel-helm", "trail-jacket",
    "frontier-mail", "apex-aegis", "pathfinder-gloves", "forgebound-gloves", "bastion-gauntlets",
    "scout-pants", "warden-greaves", "citadel-cuisses", "trail-boots",
]

ITEM_SHEET_C = [
    "march-boots", "iron-tread", "drift-cloak", "traveler-cloak", "nightwall-cloak",
    "utility-belt", "warbelt", "amulet-of-embers", "amulet-of-guarding", "frontier-ring",
    "ring-of-momentum", "ring-of-the-apex", "glass-compass", "frontier-talisman", "boss-key-fragment",
]

SKILL_SHEET = [
    "strength", "melee-accuracy", "light-melee-weapon-proficiency", "medium-melee-weapon-proficiency",
    "heavy-melee-weapon-proficiency", "marksmanship", "ranged", "offensive-magic", "support-magic",
    "reflexes", "healing", "vitality", "light-armour-proficiency", "medium-armour-proficiency",
    "heavy-armour-proficiency", "evasion", "warding",
]

# Semantic order from the generation prompt. It deliberately differs from the
# paper-doll array order so the cloak, belt, and amulet crops keep their names.
SLOT_SHEET = [
    "melee", "gun", "ranged", "magic", "helm",
    "chest", "gloves", "pants", "boots", "cloak",
    "amulet", "belt", "ring1", "ring2", "trinket1",
    "trinket2", "food",
]


def remove_checkerboard(cell: Image.Image) -> Image.Image:
    rgb = np.asarray(cell.convert("RGB"), dtype=np.uint8)
    channel_max = rgb.max(axis=2)
    channel_min = rgb.min(axis=2)
    brightness = rgb.mean(axis=2)
    spread = channel_max.astype(np.int16) - channel_min.astype(np.int16)

    # Generated checker cells occupy 235-255 and are effectively neutral.
    # Painted steel highlights carry chroma or connect to darker silhouette
    # pixels, while the deliberate cyan/orange accents are far outside this.
    background = (brightness >= 229) & (spread <= 10)
    alpha = np.where(background, 0, 255).astype(np.uint8)

    rgba = np.dstack([rgb, alpha])
    rgba[alpha == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def prune_tiny_islands(icon: Image.Image) -> Image.Image:
    """Drop adjacent-cell spill and checker seams without erasing paired gear."""
    rgba = np.array(icon.convert("RGBA"), copy=True)
    mask = rgba[:, :, 3] > 8
    visited = np.zeros(mask.shape, dtype=bool)
    components: list[list[tuple[int, int]]] = []
    height, width = mask.shape
    for start_y, start_x in np.argwhere(mask):
        if visited[start_y, start_x]:
            continue
        queue = deque([(int(start_y), int(start_x))])
        visited[start_y, start_x] = True
        component: list[tuple[int, int]] = []
        while queue:
            y, x = queue.popleft()
            component.append((y, x))
            for next_y in range(max(0, y - 1), min(height, y + 2)):
                for next_x in range(max(0, x - 1), min(width, x + 2)):
                    if mask[next_y, next_x] and not visited[next_y, next_x]:
                        visited[next_y, next_x] = True
                        queue.append((next_y, next_x))
        components.append(component)

    if not components:
        return icon
    minimum = max(10, round(max(map(len, components)) * 0.035))
    keep = np.zeros(mask.shape, dtype=bool)
    for component in components:
        if len(component) >= minimum:
            ys, xs = zip(*component)
            keep[np.asarray(ys), np.asarray(xs)] = True
    rgba[~keep] = 0
    return Image.fromarray(rgba, "RGBA")


def normalized_icon(cell: Image.Image) -> Image.Image:
    cutout = remove_checkerboard(cell)
    bbox = cutout.getbbox()
    if not bbox:
        raise ValueError("Generated cell has no readable foreground.")
    cutout = cutout.crop(bbox)
    max_content = 116
    scale = min(max_content / cutout.width, max_content / cutout.height)
    size = (max(1, round(cutout.width * scale)), max(1, round(cutout.height * scale)))
    cutout = cutout.resize(size, Image.Resampling.LANCZOS)
    icon = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    icon.alpha_composite(cutout, ((128 - size[0]) // 2, (128 - size[1]) // 2))
    return prune_tiny_islands(icon)


def extract_sheet(source: Path, names: list[str], rows: int, target: Path) -> None:
    image = Image.open(source).convert("RGB")
    columns = 5
    target.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(names):
        row, column = divmod(index, columns)
        left = round(column * image.width / columns)
        right = round((column + 1) * image.width / columns)
        top = round(row * image.height / rows)
        bottom = round((row + 1) * image.height / rows)
        icon = normalized_icon(image.crop((left, top, right, bottom)))
        icon.save(target / f"{name}.webp", "WEBP", lossless=True, quality=100, method=6)


def extract_variable_rows(source: Path, rows: list[list[str]], target: Path) -> None:
    image = Image.open(source).convert("RGB")
    target.mkdir(parents=True, exist_ok=True)
    for row, names in enumerate(rows):
        top = round(row * image.height / len(rows))
        bottom = round((row + 1) * image.height / len(rows))
        for column, name in enumerate(names):
            left = round(column * image.width / len(names))
            right = round((column + 1) * image.width / len(names))
            icon = normalized_icon(image.crop((left, top, right, bottom)))
            icon.save(target / f"{name}.webp", "WEBP", lossless=True, quality=100, method=6)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--items-a", type=Path, required=True)
    parser.add_argument("--items-b", type=Path, required=True)
    parser.add_argument("--items-c", type=Path, required=True)
    parser.add_argument("--skills", type=Path, required=True)
    parser.add_argument("--slots", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/assets/icons"))
    args = parser.parse_args()

    extract_variable_rows(args.items_a, ITEM_SHEET_A, args.output / "items")
    extract_sheet(args.items_b, ITEM_SHEET_B, 3, args.output / "items")
    extract_sheet(args.items_c, ITEM_SHEET_C, 3, args.output / "items")
    extract_sheet(args.skills, SKILL_SHEET, 4, args.output / "combat-skills")
    extract_sheet(args.slots, SLOT_SHEET, 4, args.output / "equipment-slots")


if __name__ == "__main__":
    main()
