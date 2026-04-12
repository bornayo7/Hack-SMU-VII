/*
 * ==========================================================================
 * Shared OCR Grouping Helpers
 * ==========================================================================
 *
 * OCR engines often return one box per line or even per fragment. That is
 * too fine-grained for manga bubbles because:
 *   - translation loses sentence-level context
 *   - overlays get painted as scattered line boxes
 *   - MangaOCR only sees a slice of the bubble instead of the full region
 *
 * This module groups nearby OCR detections into bubble-level regions using
 * their bounding boxes and reading direction heuristics. The grouped output
 * keeps the same shape as the rest of the extension:
 *
 *   {
 *     text: "full bubble text",
 *     bbox: { x, y, width, height },
 *     confidence: 0.91,
 *     orientation: "horizontal" | "vertical"
 *   }
 *
 * The heuristics intentionally bias toward merging stacked lines and adjacent
 * vertical columns while avoiding large jumps across separate bubbles.
 * ==========================================================================
 */

function normalizeBoundingBox(bbox) {
  if (Array.isArray(bbox) && bbox.length === 4) {
    const x1 = Math.round(Number(bbox[0]) || 0);
    const y1 = Math.round(Number(bbox[1]) || 0);
    const x2 = Math.round(Number(bbox[2]) || 0);
    const y2 = Math.round(Number(bbox[3]) || 0);

    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.max(0, Math.abs(x2 - x1)),
      height: Math.max(0, Math.abs(y2 - y1)),
    };
  }

  return {
    x: Math.round(Number(bbox?.x) || 0),
    y: Math.round(Number(bbox?.y) || 0),
    width: Math.max(0, Math.round(Number(bbox?.width) || 0)),
    height: Math.max(0, Math.round(Number(bbox?.height) || 0)),
  };
}

function cloneNormalizedBlock(block, index) {
  const bbox = normalizeBoundingBox(block?.bbox);

  return {
    text: typeof block?.text === 'string' ? block.text.trim() : String(block?.text || '').trim(),
    bbox,
    confidence: Number.isFinite(Number(block?.confidence)) ? Number(block.confidence) : 0,
    orientation: block?.orientation === 'vertical' ? 'vertical' : 'horizontal',
    _index: index,
  };
}

function boxRight(block) {
  return block.bbox.x + block.bbox.width;
}

function boxBottom(block) {
  return block.bbox.y + block.bbox.height;
}

function blockArea(block) {
  return Math.max(1, block.bbox.width * block.bbox.height);
}

function axisOverlap(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function axisGap(startA, endA, startB, endB) {
  return Math.max(0, Math.max(startA, startB) - Math.min(endA, endB));
}

function centerX(block) {
  return block.bbox.x + block.bbox.width / 2;
}

function centerY(block) {
  return block.bbox.y + block.bbox.height / 2;
}

function isVerticalBlock(block) {
  return (
    block.orientation === 'vertical' ||
    (block.bbox.width > 0 && block.bbox.height / block.bbox.width >= 1.35)
  );
}

function mergeBoundingBoxes(blocks) {
  const left = Math.min(...blocks.map((block) => block.bbox.x));
  const top = Math.min(...blocks.map((block) => block.bbox.y));
  const right = Math.max(...blocks.map((block) => boxRight(block)));
  const bottom = Math.max(...blocks.map((block) => boxBottom(block)));

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function unionFillRatio(blockA, blockB) {
  const left = Math.min(blockA.bbox.x, blockB.bbox.x);
  const top = Math.min(blockA.bbox.y, blockB.bbox.y);
  const right = Math.max(boxRight(blockA), boxRight(blockB));
  const bottom = Math.max(boxBottom(blockA), boxBottom(blockB));
  const unionArea = Math.max(1, (right - left) * (bottom - top));

  return (blockArea(blockA) + blockArea(blockB)) / unionArea;
}

function shouldMergeBlocks(blockA, blockB) {
  const xOverlap = axisOverlap(blockA.bbox.x, boxRight(blockA), blockB.bbox.x, boxRight(blockB));
  const yOverlap = axisOverlap(blockA.bbox.y, boxBottom(blockA), blockB.bbox.y, boxBottom(blockB));
  const xGap = axisGap(blockA.bbox.x, boxRight(blockA), blockB.bbox.x, boxRight(blockB));
  const yGap = axisGap(blockA.bbox.y, boxBottom(blockA), blockB.bbox.y, boxBottom(blockB));

  const minWidth = Math.max(1, Math.min(blockA.bbox.width, blockB.bbox.width));
  const minHeight = Math.max(1, Math.min(blockA.bbox.height, blockB.bbox.height));
  const avgWidth = (blockA.bbox.width + blockB.bbox.width) / 2;
  const avgHeight = (blockA.bbox.height + blockB.bbox.height) / 2;
  const fillRatio = unionFillRatio(blockA, blockB);
  const verticalPair = isVerticalBlock(blockA) && isVerticalBlock(blockB);

  if (xOverlap > 0 && yOverlap > 0) {
    return true;
  }

  if (verticalPair) {
    const neighboringColumns =
      yOverlap >= minHeight * 0.3 &&
      xGap <= Math.max(18, avgWidth * 1.2) &&
      fillRatio >= 0.16;

    const splitColumn =
      xOverlap >= minWidth * 0.45 &&
      yGap <= Math.max(8, avgWidth * 0.75) &&
      fillRatio >= 0.2;

    return neighboringColumns || splitColumn;
  }

  const stackedLines =
    xOverlap >= minWidth * 0.3 &&
    yGap <= Math.max(18, avgHeight * 1.6) &&
    fillRatio >= 0.16;

  const splitLine =
    yOverlap >= minHeight * 0.45 &&
    xGap <= Math.max(8, avgHeight * 0.75) &&
    fillRatio >= 0.2;

  const diagonalNeighbor =
    xGap <= Math.max(6, Math.min(avgWidth, avgHeight) * 0.4) &&
    yGap <= Math.max(6, Math.min(avgWidth, avgHeight) * 0.4) &&
    fillRatio >= 0.22;

  return stackedLines || splitLine || diagonalNeighbor;
}

function shouldInsertSpace(leftText, rightText) {
  const left = (leftText || '').trimEnd();
  const right = (rightText || '').trimStart();

  if (!left || !right) {
    return false;
  }

  const lastChar = left.slice(-1);
  const firstChar = right[0];

  if (/\s/.test(lastChar) || /\s/.test(firstChar)) {
    return false;
  }

  if (/[(\[{'"“‘-]$/.test(left) || /^[)\]}'",.!?;:」』、。]/.test(right)) {
    return false;
  }

  return /[A-Za-z0-9]/.test(lastChar) || /[A-Za-z0-9]/.test(firstChar);
}

function joinFragments(fragments, separator) {
  let text = '';

  for (const fragment of fragments) {
    const trimmed = (fragment || '').trim();
    if (!trimmed) continue;

    if (!text) {
      text = trimmed;
      continue;
    }

    text += shouldInsertSpace(text, trimmed) ? separator : '';
    text += trimmed;
  }

  return text;
}

function clusterLines(blocks, orientation) {
  if (orientation === 'vertical') {
    const sorted = blocks
      .slice()
      .sort((left, right) => (
        centerX(right) - centerX(left) ||
        centerY(left) - centerY(right) ||
        left._index - right._index
      ));

    const columns = [];

    for (const block of sorted) {
      let bestColumn = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const column of columns) {
        const overlap = axisOverlap(
          block.bbox.x,
          boxRight(block),
          column.rangeStart,
          column.rangeEnd
        );
        const distance = Math.abs(centerX(block) - column.center);
        const closeEnough =
          overlap >= Math.min(block.bbox.width, column.avgWidth) * 0.25 ||
          distance <= Math.max(12, Math.min(block.bbox.width, column.avgWidth) * 0.9);

        if (closeEnough && distance < bestDistance) {
          bestColumn = column;
          bestDistance = distance;
        }
      }

      if (!bestColumn) {
        columns.push({
          blocks: [block],
          center: centerX(block),
          avgWidth: block.bbox.width,
          rangeStart: block.bbox.x,
          rangeEnd: boxRight(block),
        });
        continue;
      }

      bestColumn.blocks.push(block);
      bestColumn.center =
        bestColumn.blocks.reduce((sum, entry) => sum + centerX(entry), 0) / bestColumn.blocks.length;
      bestColumn.avgWidth =
        bestColumn.blocks.reduce((sum, entry) => sum + entry.bbox.width, 0) / bestColumn.blocks.length;
      bestColumn.rangeStart = Math.min(bestColumn.rangeStart, block.bbox.x);
      bestColumn.rangeEnd = Math.max(bestColumn.rangeEnd, boxRight(block));
    }

    return columns
      .sort((left, right) => right.center - left.center)
      .map((column) => column.blocks.sort((left, right) => (
        left.bbox.y - right.bbox.y ||
        left.bbox.x - right.bbox.x ||
        left._index - right._index
      )));
  }

  const sorted = blocks
    .slice()
    .sort((left, right) => (
      centerY(left) - centerY(right) ||
      centerX(left) - centerX(right) ||
      left._index - right._index
    ));

  const rows = [];

  for (const block of sorted) {
    let bestRow = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const row of rows) {
      const overlap = axisOverlap(
        block.bbox.y,
        boxBottom(block),
        row.rangeStart,
        row.rangeEnd
      );
      const distance = Math.abs(centerY(block) - row.center);
      const closeEnough =
        overlap >= Math.min(block.bbox.height, row.avgHeight) * 0.25 ||
        distance <= Math.max(12, Math.min(block.bbox.height, row.avgHeight) * 0.8);

      if (closeEnough && distance < bestDistance) {
        bestRow = row;
        bestDistance = distance;
      }
    }

    if (!bestRow) {
      rows.push({
        blocks: [block],
        center: centerY(block),
        avgHeight: block.bbox.height,
        rangeStart: block.bbox.y,
        rangeEnd: boxBottom(block),
      });
      continue;
    }

    bestRow.blocks.push(block);
    bestRow.center =
      bestRow.blocks.reduce((sum, entry) => sum + centerY(entry), 0) / bestRow.blocks.length;
    bestRow.avgHeight =
      bestRow.blocks.reduce((sum, entry) => sum + entry.bbox.height, 0) / bestRow.blocks.length;
    bestRow.rangeStart = Math.min(bestRow.rangeStart, block.bbox.y);
    bestRow.rangeEnd = Math.max(bestRow.rangeEnd, boxBottom(block));
  }

  return rows
    .sort((left, right) => left.center - right.center)
    .map((row) => row.blocks.sort((left, right) => (
      left.bbox.x - right.bbox.x ||
      left.bbox.y - right.bbox.y ||
      left._index - right._index
    )));
}

function buildGroupedText(blocks, orientation) {
  const lines = clusterLines(blocks, orientation)
    .map((lineBlocks) => {
      const fragments = lineBlocks.map((block) => block.text);
      const separator = orientation === 'vertical' ? '' : ' ';
      return joinFragments(fragments, separator);
    })
    .filter(Boolean);

  if (lines.length === 0) {
    return joinFragments(blocks.map((block) => block.text), ' ');
  }

  return lines.join('\n');
}

function dominantOrientation(blocks, mergedBox) {
  const verticalVotes = blocks.filter(isVerticalBlock).length;

  if (verticalVotes === 0) {
    return 'horizontal';
  }

  if (verticalVotes === blocks.length) {
    return 'vertical';
  }

  return mergedBox.height > mergedBox.width * 1.2 ? 'vertical' : 'horizontal';
}

function buildGroupedBlock(blocks) {
  const mergedBox = mergeBoundingBoxes(blocks);
  const orientation = dominantOrientation(blocks, mergedBox);
  const text = buildGroupedText(blocks, orientation);
  const avgConfidence =
    blocks.reduce((sum, block) => sum + Math.max(0, Math.min(1, Number(block.confidence) || 0)), 0) /
    blocks.length;

  return {
    text,
    bbox: mergedBox,
    confidence: avgConfidence,
    orientation,
    _index: Math.min(...blocks.map((block) => block._index)),
  };
}

export function groupTextBlocks(blocks) {
  const normalizedBlocks = (blocks || [])
    .map((block, index) => cloneNormalizedBlock(block, index))
    .filter((block) => block.text.length > 0 && block.bbox.width > 0 && block.bbox.height > 0);

  if (normalizedBlocks.length <= 1) {
    return normalizedBlocks.map(({ _index, ...block }) => block);
  }

  const visited = new Array(normalizedBlocks.length).fill(false);
  const groupedBlocks = [];

  for (let index = 0; index < normalizedBlocks.length; index++) {
    if (visited[index]) continue;

    const stack = [index];
    const component = [];
    visited[index] = true;

    while (stack.length > 0) {
      const currentIndex = stack.pop();
      const currentBlock = normalizedBlocks[currentIndex];
      component.push(currentBlock);

      for (let otherIndex = 0; otherIndex < normalizedBlocks.length; otherIndex++) {
        if (visited[otherIndex]) continue;

        if (shouldMergeBlocks(currentBlock, normalizedBlocks[otherIndex])) {
          visited[otherIndex] = true;
          stack.push(otherIndex);
        }
      }
    }

    groupedBlocks.push(buildGroupedBlock(component));
  }

  return groupedBlocks
    .sort((left, right) => left._index - right._index)
    .map(({ _index, ...block }) => block);
}
