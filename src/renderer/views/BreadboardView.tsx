import { useRef, useEffect, useCallback } from 'react';
import { Application, Graphics, Container, Text, TextStyle, FederatedPointerEvent } from 'pixi.js';
import type { Board, HolePosition, Wire as WireType, BoardCol } from '../../shared/board-types';
import { BOARD_ROWS, BOARD_COLS } from '../../shared/board-types';
import type { Placement } from '../../shared/board-types';
import { useCircuitStore } from '../stores/circuit-store';
import { useUIStore } from '../stores/ui-store';
import { COMPONENT_LIBRARY } from '../panels/ComponentLibrary';

// ---- Layout Constants (matching real BB830 proportions) ----
const HOLE_SPACING = 14;       // 0.1" pitch scaled up for visibility
const HOLE_SIZE = 3;           // Square hole half-size
const RAIL_HOLE_SIZE = HOLE_SIZE; // Same size as main holes
const RAIL_WIDTH = 30;         // Width of each power rail column (wide enough for lines outside holes)
const RAIL_LINE_INSET = 3;     // Inset of colored line from rail edge
const RAIL_GAP = 20;           // Gap between rail and main holes (space for row numbers)
const COL_SPACING = HOLE_SPACING;
const CENTER_GAP = HOLE_SPACING * 3; // 0.3" DIP gap
const TOP_MARGIN = 28;         // Space for top labels
const BOTTOM_MARGIN = 28;      // Space for bottom labels
const SIDE_MARGIN = 8;         // Space between rail and board edge

// Derived positions
const LEFT_RAIL_X = SIDE_MARGIN;
const LEFT_COLS_START = LEFT_RAIL_X + RAIL_WIDTH + RAIL_GAP;
const RIGHT_COLS_START = LEFT_COLS_START + 4 * COL_SPACING + CENTER_GAP;
const RIGHT_RAIL_X = RIGHT_COLS_START + 4 * COL_SPACING + RAIL_GAP;
const BOARD_WIDTH = RIGHT_RAIL_X + RAIL_WIDTH + SIDE_MARGIN;
const FIRST_ROW_Y = TOP_MARGIN;
const BOARD_HEIGHT = TOP_MARGIN + BOTTOM_MARGIN + (BOARD_ROWS - 1) * HOLE_SPACING;

const COL_LABELS = BOARD_COLS;

// Rail column IDs: +L/-L = left rail outer/inner, +R/-R = right rail outer/inner
const RAIL_COL_IDS = ['+L', '-L', '-R', '+R'] as const;

function colIndex(col: BoardCol): number {
  return BOARD_COLS.indexOf(col);
}

// Extended holeX that handles both main columns and rail columns
function holeX(col: string): number {
  // Rail columns
  // Both rails: + on left column, − on right column
  if (col === '+L') return LEFT_RAIL_X + 10;
  if (col === '-L') return LEFT_RAIL_X + RAIL_WIDTH - 10;
  if (col === '+R') return RIGHT_RAIL_X + 10;
  if (col === '-R') return RIGHT_RAIL_X + RAIL_WIDTH - 10;
  // Main columns
  const ci = colIndex(col as BoardCol);
  if (ci < 5) return LEFT_COLS_START + ci * COL_SPACING;
  return RIGHT_COLS_START + (ci - 5) * COL_SPACING;
}

function holeY(row: number): number {
  return FIRST_ROW_Y + (row - 1) * HOLE_SPACING;
}

// Resistor color band lookup: digit -> color
const BAND_COLORS: number[] = [
  0x000000, // 0 = black
  0x884422, // 1 = brown
  0xcc2222, // 2 = red
  0xee6622, // 3 = orange
  0xddcc00, // 4 = yellow
  0x22aa22, // 5 = green
  0x2255cc, // 6 = blue
  0x8833cc, // 7 = violet
  0x666666, // 8 = grey
  0xeeeeee, // 9 = white
];
const TOLERANCE_GOLD = 0xccaa33;
const TOLERANCE_SILVER = 0xbbbbbb;

/** Convert resistance in ohms to 4-band color codes [digit1, digit2, multiplier, tolerance] */
function resistorBands(ohms: number): number[] {
  if (!ohms || !isFinite(ohms) || ohms <= 0) return [BAND_COLORS[0], BAND_COLORS[0], BAND_COLORS[0], TOLERANCE_GOLD];

  // Normalize to 2 significant digits
  let value = ohms;
  let multiplier = 0;

  if (value >= 10) {
    while (value >= 100) { value /= 10; multiplier++; }
  } else if (value < 10 && value >= 1) {
    // Values like 4.7 ohm — use gold multiplier (0.1)
    value *= 10;
    multiplier = -1;
  } else {
    // Sub-1 ohm
    value *= 100;
    multiplier = -2;
  }

  const d1 = Math.floor(value / 10) % 10;
  const d2 = Math.round(value) % 10;

  // Multiplier band color
  let multColor: number;
  if (multiplier === -1) multColor = TOLERANCE_GOLD;
  else if (multiplier === -2) multColor = TOLERANCE_SILVER;
  else multColor = BAND_COLORS[Math.min(multiplier, 9)];

  return [BAND_COLORS[d1], BAND_COLORS[d2], multColor, TOLERANCE_GOLD];
}

// Colors
const COLORS = {
  boardBg: 0xf0ece4,
  hole: 0x2a2a2a,
  holeHover: 0x00aaff,
  railRed: 0xcc2222,
  railBlue: 0x2244bb,
  railHole: 0x444444,
  centerGap: 0xd8d0c4,
  labelColor: 0x888888,
  labelColorAccent: 0xcc2222,
  wireColors: {
    red: 0xff3333, black: 0x222222, blue: 0x3366ff, green: 0x33cc66,
    yellow: 0xffcc00, orange: 0xff8800, white: 0xdddddd, purple: 0x9933ff,
  } as Record<string, number>,
  dip: {
    body: 0x2a2a2a,
    pin: 0xbbbbbb,
    notch: 0x444444,
    label: 0xcccccc,
    dot: 0xcccccc,
  },
  passive: { resistor: 0xd4a574, capacitor: 0x6699cc },
  selected: 0x00ff88,
};

interface Props {
  board: Board;
}

export function BreadboardView({ board }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const containerRef = useRef<Container | null>(null);

  const { project, addComponent, addWire } = useCircuitStore();
  const uiStore = useUIStore();

  const getComponent = useCallback((componentId: string) => {
    return project.netlist.components.find(c => c.id === componentId);
  }, [project.netlist.components]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const pixiApp = new Application();
    const initPromise = pixiApp.init({
      resizeTo: canvasRef.current,
      background: 0x111111,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    initPromise.then(() => {
      if (!canvasRef.current) return;
      canvasRef.current.appendChild(pixiApp.canvas as HTMLCanvasElement);
      appRef.current = pixiApp;
      const mainContainer = new Container();
      // Center the board horizontally
      const canvasW = canvasRef.current.clientWidth;
      mainContainer.x = Math.max(20, (canvasW - BOARD_WIDTH) / 2);
      mainContainer.y = 10;
      pixiApp.stage.addChild(mainContainer);
      containerRef.current = mainContainer;
      drawBoard(mainContainer);
    });

    return () => { pixiApp.destroy(true); appRef.current = null; };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.removeChildren();
    drawBoard(containerRef.current);
  }, [board, project.netlist.components, uiStore.toolMode, uiStore.hoveredHole, uiStore.wireStart, uiStore.selectedItemId, uiStore.hoveredPin, uiStore.passivePin1]);

  // =========================================================
  // DRAW BOARD
  // =========================================================
  function drawBoard(container: Container) {
    // Board background
    const bg = new Graphics();
    bg.roundRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT, 6);
    bg.fill(COLORS.boardBg);
    container.addChild(bg);

    // ---- Power rails (vertical, on left and right sides) ----
    drawVerticalRail(container, LEFT_RAIL_X, 'left');
    drawVerticalRail(container, RIGHT_RAIL_X, 'right');

    // ---- Center gap ----
    const gapX = LEFT_COLS_START + 4 * COL_SPACING + (CENTER_GAP - COL_SPACING) / 2 - 2;
    const gapW = COL_SPACING + 4;
    const centerGap = new Graphics();
    centerGap.rect(gapX, FIRST_ROW_Y - 6, gapW, (BOARD_ROWS - 1) * HOLE_SPACING + 12);
    centerGap.fill(COLORS.centerGap);
    container.addChild(centerGap);

    // ---- Column labels (top and bottom) ----
    const labelStyle = new TextStyle({ fontSize: 11, fill: COLORS.labelColor, fontFamily: 'monospace', fontWeight: 'bold' });
    for (const col of COL_LABELS) {
      const lx = holeX(col);
      // Top label
      const topLabel = new Text({ text: col, style: labelStyle });
      topLabel.anchor.set(0.5, 1);
      topLabel.x = lx;
      topLabel.y = FIRST_ROW_Y - 8;
      container.addChild(topLabel);
      // Bottom label
      const botLabel = new Text({ text: col, style: labelStyle });
      botLabel.anchor.set(0.5, 0);
      botLabel.x = lx;
      botLabel.y = holeY(BOARD_ROWS) + 8;
      container.addChild(botLabel);
    }

    // ---- Row labels and holes ----
    const rowLabelStyle = new TextStyle({ fontSize: 10, fill: COLORS.labelColor, fontFamily: 'monospace', fontWeight: 'bold' });
    for (let row = 1; row <= BOARD_ROWS; row++) {
      const y = holeY(row);

      // Row number every 5 rows (between left rail and col a, and between col j and right rail)
      if (row % 5 === 0) {
        const lbl = String(row);
        const leftLbl = new Text({ text: lbl, style: rowLabelStyle });
        leftLbl.anchor.set(1, 0.5);
        leftLbl.x = LEFT_COLS_START - 6;
        leftLbl.y = y;
        container.addChild(leftLbl);

        const rightLbl = new Text({ text: lbl, style: rowLabelStyle });
        rightLbl.anchor.set(0, 0.5);
        rightLbl.x = RIGHT_COLS_START + 4 * COL_SPACING + 6;
        rightLbl.y = y;
        container.addChild(rightLbl);
      }

      // Holes (square)
      for (const col of COL_LABELS) {
        const x = holeX(col);
        const hole = new Graphics();
        const isHovered = uiStore.hoveredHole?.row === row && uiStore.hoveredHole?.col === col;
        const isWireStart = uiStore.wireStart?.row === row && uiStore.wireStart?.col === col && uiStore.wireStart?.boardId === board.id;
        const isPassiveStart = uiStore.passivePin1?.row === row && uiStore.passivePin1?.col === col && uiStore.passivePin1?.boardId === board.id;

        hole.rect(x - HOLE_SIZE, y - HOLE_SIZE, HOLE_SIZE * 2, HOLE_SIZE * 2);
        if (isWireStart || isPassiveStart) {
          hole.fill(0x00ff00);
        } else if (isHovered) {
          hole.fill(COLORS.holeHover);
        } else {
          hole.fill(COLORS.hole);
        }

        hole.eventMode = 'static';
        hole.cursor = 'pointer';
        hole.hitArea = { contains: (px: number, py: number) => Math.abs(px - x) < HOLE_SPACING / 2 && Math.abs(py - y) < HOLE_SPACING / 2 };
        hole.on('pointerenter', () => useUIStore.getState().setHoveredHole({ row, col }));
        hole.on('pointerleave', () => useUIStore.getState().setHoveredHole(null));
        hole.on('pointerdown', (e: FederatedPointerEvent) => handleHoleClick(row, col as BoardCol, e));
        container.addChild(hole);
      }
    }

    // ---- Placed components ----
    for (const placement of board.placements) {
      const component = getComponent(placement.componentId);
      if (!component) continue;
      drawComponent(container, placement, component);
    }

    // ---- Wires ----
    for (const wire of board.wires) { drawWire(container, wire); }

    // ---- In-progress wire preview ----
    if (uiStore.wireStart && uiStore.wireStart.boardId === board.id && uiStore.hoveredHole) {
      const preview = new Graphics();
      const sx = holeX(uiStore.wireStart.col as BoardCol), sy = holeY(uiStore.wireStart.row);
      const ex = holeX(uiStore.hoveredHole.col as BoardCol), ey = holeY(uiStore.hoveredHole.row);
      preview.moveTo(sx, sy); preview.lineTo(ex, ey);
      preview.stroke({ width: 3, color: COLORS.wireColors[uiStore.wireColor] ?? 0x3366ff, alpha: 0.5 });
      container.addChild(preview);
    }

    // ---- In-progress passive placement preview ----
    if (uiStore.passivePin1 && uiStore.passivePin1.boardId === board.id && uiStore.hoveredHole) {
      const preview = new Graphics();
      const sx = holeX(uiStore.passivePin1.col as BoardCol), sy = holeY(uiStore.passivePin1.row);
      const ex = holeX(uiStore.hoveredHole.col as BoardCol), ey = holeY(uiStore.hoveredHole.row);
      preview.moveTo(sx, sy); preview.lineTo(ex, ey);
      preview.stroke({ width: 1.5, color: 0x888888, alpha: 0.4 });
      preview.circle(sx, sy, 3); preview.fill({ color: 0x00ff88, alpha: 0.7 });
      preview.circle(ex, ey, 3); preview.fill({ color: 0xffaa00, alpha: 0.7 });
      container.addChild(preview);
    }
  }

  // =========================================================
  // VERTICAL POWER RAIL (like real BB830 — red+blue lines on sides)
  // =========================================================
  function drawVerticalRail(container: Container, railX: number, side: 'left' | 'right') {
    const topY = FIRST_ROW_Y;
    const botY = holeY(BOARD_ROWS);

    // Both rails read +− left to right: red(+) on left edge, blue(−) on right edge
    const leftEdgeX = railX + RAIL_LINE_INSET;
    const rightEdgeX = railX + RAIL_WIDTH - RAIL_LINE_INSET;

    // Hole columns sit between the two rail lines
    const leftHoleX = railX + 10;
    const rightHoleX = railX + RAIL_WIDTH - 10;

    // Red (+) line on left edge
    const redLine = new Graphics();
    redLine.moveTo(leftEdgeX, topY - 4); redLine.lineTo(leftEdgeX, botY + 4);
    redLine.stroke({ width: 3, color: COLORS.railRed });
    container.addChild(redLine);

    // Blue (−) line on right edge
    const blueLine = new Graphics();
    blueLine.moveTo(rightEdgeX, topY - 4); blueLine.lineTo(rightEdgeX, botY + 4);
    blueLine.stroke({ width: 3, color: COLORS.railBlue });
    container.addChild(blueLine);

    // Labels: + on left, − on right
    const plusStyle = new TextStyle({ fontSize: 10, fill: COLORS.railRed, fontFamily: 'monospace', fontWeight: 'bold' });
    const minusStyle = new TextStyle({ fontSize: 10, fill: COLORS.railBlue, fontFamily: 'monospace', fontWeight: 'bold' });

    const tp = new Text({ text: '+', style: plusStyle }); tp.anchor.set(0.5, 1); tp.x = leftEdgeX; tp.y = topY - 8; container.addChild(tp);
    const tm = new Text({ text: '\u2013', style: minusStyle }); tm.anchor.set(0.5, 1); tm.x = rightEdgeX; tm.y = topY - 8; container.addChild(tm);
    const bp = new Text({ text: '+', style: plusStyle }); bp.anchor.set(0.5, 0); bp.x = leftEdgeX; bp.y = botY + 8; container.addChild(bp);
    const bm = new Text({ text: '\u2013', style: minusStyle }); bm.anchor.set(0.5, 0); bm.x = rightEdgeX; bm.y = botY + 8; container.addChild(bm);

    // Rail holes: 10 groups of 5, starting row 3, ending row 61.
    // Groups: 3-7, 9-13, 15-19, 21-25, 27-31, 33-37, 39-43, 45-49, 51-55, 57-61
    const RAIL_GROUPS = [
      [3, 7], [9, 13], [15, 19], [21, 25], [27, 31],
      [33, 37], [39, 43], [45, 49], [51, 55], [57, 61],
    ];

    const plusColId = side === 'left' ? '+L' : '+R';
    const minusColId = side === 'left' ? '-L' : '-R';

    for (const [start, end] of RAIL_GROUPS) {
      for (let row = start; row <= end; row++) {
        const y = holeY(row);

        // + hole (left column)
        drawRailHole(container, leftHoleX, y, row, plusColId);

        // − hole (right column)
        drawRailHole(container, rightHoleX, y, row, minusColId);
      }
    }
  }

  // =========================================================
  // DRAW RAIL HOLE (interactive, supports wiring)
  // =========================================================
  function drawRailHole(container: Container, x: number, y: number, row: number, colId: string) {
    const hole = new Graphics();
    const isHovered = uiStore.hoveredHole?.row === row && uiStore.hoveredHole?.col === colId;
    const isWireStart = uiStore.wireStart?.row === row && uiStore.wireStart?.col === colId && uiStore.wireStart?.boardId === board.id;
    const isPassiveStart = uiStore.passivePin1?.row === row && uiStore.passivePin1?.col === colId && uiStore.passivePin1?.boardId === board.id;

    hole.rect(x - HOLE_SIZE, y - HOLE_SIZE, HOLE_SIZE * 2, HOLE_SIZE * 2);
    if (isWireStart || isPassiveStart) {
      hole.fill(0x00ff00);
    } else if (isHovered) {
      hole.fill(COLORS.holeHover);
    } else {
      hole.fill(COLORS.hole);
    }

    hole.eventMode = 'static';
    hole.cursor = 'pointer';
    hole.hitArea = { contains: (px: number, py: number) => Math.abs(px - x) < HOLE_SPACING / 2 && Math.abs(py - y) < HOLE_SPACING / 2 };
    hole.on('pointerenter', () => useUIStore.getState().setHoveredHole({ row, col: colId }));
    hole.on('pointerleave', () => useUIStore.getState().setHoveredHole(null));
    hole.on('pointerdown', (e: FederatedPointerEvent) => handleHoleClick(row, colId as BoardCol, e));
    container.addChild(hole);
  }

  // =========================================================
  // DRAW COMPONENT (DIP IC or passive)
  // =========================================================
  function drawComponent(container: Container, placement: Placement, component: { type: string; label?: string; package: string; pins: { index: number; name: string }[]; parameters: Record<string, number> }) {
    const { pin1Position } = placement;
    const pinCount = component.pins.length;
    const isSelected = uiStore.selectedItemId === placement.componentId;
    const hp = uiStore.hoveredPin;

    if (component.package.startsWith('DIP')) {
      const pinsPerSide = pinCount / 2;
      const startRow = pin1Position.row;

      // Body spans from column e to column f, straddling center gap
      const leftEdge = holeX('e' as BoardCol);
      const rightEdge = holeX('f' as BoardCol);
      const bodyX = leftEdge - 4;
      const bodyW = rightEdge - leftEdge + 8;
      const bodyY = holeY(startRow) - HOLE_SPACING * 0.4;
      const bodyH = (pinsPerSide - 1) * HOLE_SPACING + HOLE_SPACING * 0.8;

      // IC body
      const body = new Graphics();
      body.roundRect(bodyX, bodyY, bodyW, bodyH, 3);
      body.fill(COLORS.dip.body);
      if (isSelected) {
        body.roundRect(bodyX - 2, bodyY - 2, bodyW + 4, bodyH + 4, 5);
        body.stroke({ width: 2, color: COLORS.selected });
      }
      container.addChild(body);

      // Pin 1 dot — large filled circle at top-left corner
      const dotX = bodyX + 6;
      const dotY = bodyY + 6;
      const dot = new Graphics();
      dot.circle(dotX, dotY, 3);
      dot.fill(COLORS.dip.dot);
      container.addChild(dot);

      // Orientation notch — semicircle at top center
      const notch = new Graphics();
      const notchX = bodyX + bodyW / 2;
      notch.arc(notchX, bodyY, 5, 0, Math.PI);
      notch.fill(COLORS.dip.notch);
      notch.stroke({ width: 1, color: 0x555555 });
      container.addChild(notch);

      // Pin legs and numbers
      for (let i = 0; i < pinsPerSide; i++) {
        const pinY = holeY(startRow + i);

        // Left pins: index 0..pinsPerSide-1 top to bottom
        const leftIdx = i;
        const isLeftHov = hp?.componentId === placement.componentId && hp?.pinIndex === leftIdx;

        // Left pin leg extending out from body
        const leftLeg = new Graphics();
        leftLeg.moveTo(bodyX, pinY);
        leftLeg.lineTo(bodyX - 5, pinY);
        leftLeg.stroke({ width: 3, color: isLeftHov ? 0x00ff88 : COLORS.dip.pin });
        container.addChild(leftLeg);

        if (isLeftHov) {
          const glow = new Graphics();
          glow.circle(holeX('e' as BoardCol), pinY, 6);
          glow.stroke({ width: 2, color: 0x00ff88 });
          container.addChild(glow);
          const lbl = new Text({ text: component.pins[leftIdx]?.name ?? '', style: new TextStyle({ fontSize: 8, fill: 0x00ff88, fontFamily: 'monospace' }) });
          lbl.anchor.set(1, 0.5);
          lbl.x = bodyX - 10; lbl.y = pinY;
          container.addChild(lbl);
        }

        // Right pins: index pinCount-1-i top to bottom
        const rightIdx = pinCount - 1 - i;
        const isRightHov = hp?.componentId === placement.componentId && hp?.pinIndex === rightIdx;

        const rightLeg = new Graphics();
        rightLeg.moveTo(bodyX + bodyW, pinY);
        rightLeg.lineTo(bodyX + bodyW + 5, pinY);
        rightLeg.stroke({ width: 3, color: isRightHov ? 0x00ff88 : COLORS.dip.pin });
        container.addChild(rightLeg);

        if (isRightHov) {
          const glow = new Graphics();
          glow.circle(holeX('f' as BoardCol), pinY, 6);
          glow.stroke({ width: 2, color: 0x00ff88 });
          container.addChild(glow);
          const lbl = new Text({ text: component.pins[rightIdx]?.name ?? '', style: new TextStyle({ fontSize: 8, fill: 0x00ff88, fontFamily: 'monospace' }) });
          lbl.anchor.set(0, 0.5);
          lbl.x = bodyX + bodyW + 10; lbl.y = pinY;
          container.addChild(lbl);
        }
      }

      // IC label — rotated 90 degrees, larger text, centered on body
      const label = new Text({
        text: component.label ?? component.type,
        style: new TextStyle({
          fontSize: 10,
          fill: COLORS.dip.label,
          fontFamily: 'monospace',
          fontWeight: 'bold',
        }),
      });
      label.anchor.set(0.5, 0.5);
      label.x = bodyX + bodyW / 2;
      label.y = bodyY + bodyH / 2;
      label.rotation = -Math.PI / 2; // Rotated 90 degrees CCW
      container.addChild(label);

      // Clickable
      body.eventMode = 'static';
      body.cursor = 'pointer';
      body.on('pointerdown', () => useUIStore.getState().selectItem(placement.componentId, 'component'));

    } else if (component.type === 'transistor') {
      // ---- Transistor (TO-92 package) ----
      // Pin 1 = Base/Gate at pin1Position, pins span 3 rows
      const cx = holeX(pin1Position.col);
      const baseY = holeY(pin1Position.row);
      const collY = holeY(pin1Position.row - 1);  // Collector above (if space)
      const emitY = holeY(pin1Position.row + 1);  // Emitter below
      const p2 = placement.pin2Position;
      const topY = Math.min(baseY, collY);
      const botY = Math.max(baseY, emitY);
      const midY = (topY + botY) / 2;

      const bodyR = 8;
      const isNPN = (component.parameters['type'] ?? 0) === 0;

      // D-shaped body: semicircle + flat side
      const transistorGfx = new Graphics();
      // Flat side on left, round on right (or vice versa based on column)
      const flatDir = colIndex(pin1Position.col) < 5 ? 1 : -1;

      // Draw filled semicircle body
      transistorGfx.arc(cx, midY, bodyR, -Math.PI / 2 * flatDir + Math.PI / 2, Math.PI / 2 * flatDir + Math.PI / 2);
      transistorGfx.lineTo(cx - flatDir * 2, midY - bodyR);
      transistorGfx.closePath();
      transistorGfx.fill(0x222222);
      transistorGfx.stroke({ width: 1, color: 0x444444 });

      // Flat edge marker
      transistorGfx.moveTo(cx - flatDir * 2, midY - bodyR);
      transistorGfx.lineTo(cx - flatDir * 2, midY + bodyR);
      transistorGfx.stroke({ width: 2, color: 0x444444 });

      if (isSelected) {
        transistorGfx.circle(cx, midY, bodyR + 3);
        transistorGfx.stroke({ width: 2, color: COLORS.selected });
      }

      // Pin leads and labels — always visible
      // Row order: Collector/Drain (row-1), Base/Gate (row), Emitter/Source (row+1)
      // Pin index order in component.pins: [0]=Base, [1]=Collector, [2]=Emitter
      const pinMap = [
        { row: pin1Position.row - 1, pinIdx: 1 },  // Collector/Drain
        { row: pin1Position.row,     pinIdx: 0 },  // Base/Gate
        { row: pin1Position.row + 1, pinIdx: 2 },  // Emitter/Source
      ];

      for (const { row: pRow, pinIdx } of pinMap) {
        if (pRow < 1 || pRow > BOARD_ROWS) continue;
        const py = holeY(pRow);
        const isPinHov = hp?.componentId === placement.componentId && hp?.pinIndex === pinIdx;
        const pinLetter = component.pins[pinIdx]?.name?.charAt(0) ?? '?';
        const legColor = isPinHov ? 0x00ff88 : 0x888888;

        // Lead extending from body outward
        const legEndX = cx - flatDir * (bodyR + 6);
        transistorGfx.moveTo(cx - flatDir * 2, py);
        transistorGfx.lineTo(legEndX, py);
        transistorGfx.stroke({ width: 2.5, color: legColor });

        // Pin dot at the hole
        transistorGfx.circle(cx, py, 2.5);
        transistorGfx.fill(legColor);

        // Always show pin letter label
        const labelColor = isPinHov ? 0x00ff88 : 0x999999;
        const pinLabel = new Text({
          text: pinLetter,
          style: new TextStyle({ fontSize: 11, fill: labelColor, fontFamily: 'monospace', fontWeight: 'bold' }),
        });
        pinLabel.anchor.set(flatDir > 0 ? 1 : 0, 0.5);
        pinLabel.x = legEndX + (flatDir > 0 ? -3 : 3);
        pinLabel.y = py;
        container.addChild(pinLabel);

        // Hover glow
        if (isPinHov) {
          const glow = new Graphics();
          glow.circle(cx, py, 6);
          glow.stroke({ width: 2, color: 0x00ff88 });
          container.addChild(glow);
        }
      }

      // Component name label
      const tLabel = new Text({
        text: component.label ?? (isNPN ? 'NPN' : 'PNP'),
        style: new TextStyle({ fontSize: 8, fill: 0xaaaaaa, fontFamily: 'monospace', fontWeight: 'bold' }),
      });
      tLabel.anchor.set(0.5, 0.5);
      tLabel.x = cx + flatDir * 4;
      tLabel.y = midY;
      container.addChild(tLabel);

      transistorGfx.eventMode = 'static'; transistorGfx.cursor = 'pointer';
      transistorGfx.on('pointerdown', () => useUIStore.getState().selectItem(placement.componentId, 'component'));
      container.addChild(transistorGfx);

    } else {
      // ---- Passive component (resistor/capacitor/pot) ----
      const x1 = holeX(pin1Position.col);
      const y1 = holeY(pin1Position.row);
      const p2 = placement.pin2Position;
      if (!p2) return;

      const x2 = holeX(p2.col);
      const y2 = holeY(p2.row);
      const dx = x2 - x1, dy = y2 - y1;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

      const passive = new Graphics();
      const isDiode = component.type === 'diode';
      const isResistor = component.package === 'axial' && !isDiode;
      const isCap = component.type === 'capacitor';
      const LEAD_COLOR = 0xaaaaaa;
      const bodyLen = isResistor ? Math.min(dist * 0.55, 32) : isDiode ? Math.min(dist * 0.5, 28) : Math.min(dist * 0.45, 22);
      const leadLen = (dist - bodyLen) / 2;

      // Leads — silver wire
      passive.moveTo(x1, y1);
      passive.lineTo(x1 + Math.cos(angle) * leadLen, y1 + Math.sin(angle) * leadLen);
      passive.stroke({ width: 1.5, color: LEAD_COLOR });
      passive.moveTo(x2, y2);
      passive.lineTo(x2 - Math.cos(angle) * leadLen, y2 - Math.sin(angle) * leadLen);
      passive.stroke({ width: 1.5, color: LEAD_COLOR });

      const bodyH = isResistor ? 8 : isDiode ? 7 : 10;
      const perpX = -Math.sin(angle) * bodyH / 2;
      const perpY = Math.cos(angle) * bodyH / 2;
      const bodyStartX = mx - Math.cos(angle) * bodyLen / 2;
      const bodyStartY = my - Math.sin(angle) * bodyLen / 2;
      const bodyEndX = mx + Math.cos(angle) * bodyLen / 2;
      const bodyEndY = my + Math.sin(angle) * bodyLen / 2;

      if (isResistor) {
        // Fritzing-style resistor: rounded capsule body with color bands
        // Draw capsule shape: rounded ends with straight sides
        const capR = bodyH / 2;

        // Left cap (semicircle)
        passive.arc(bodyStartX, bodyStartY, capR, angle + Math.PI / 2, angle - Math.PI / 2);
        // Top edge
        passive.lineTo(bodyEndX + perpX, bodyEndY + perpY);
        // Right cap (semicircle)
        passive.arc(bodyEndX, bodyEndY, capR, angle - Math.PI / 2, angle + Math.PI / 2);
        // Bottom edge back to start
        passive.lineTo(bodyStartX - perpX, bodyStartY - perpY);
        passive.closePath();
        passive.fill(COLORS.passive.resistor);
        passive.stroke({ width: 0.8, color: 0x8a6b44 });

        // 4-band color code
        const bands = resistorBands(component.parameters['resistance'] ?? 10000);
        const bandPositions = [0.15, 0.30, 0.45, 0.80];
        const bandWidths = [3, 3, 3, 2.5];
        for (let b = 0; b < bands.length; b++) {
          const t = bandPositions[b];
          const bpx = bodyStartX + Math.cos(angle) * bodyLen * t;
          const bpy = bodyStartY + Math.sin(angle) * bodyLen * t;
          passive.moveTo(bpx + perpX * 0.92, bpy + perpY * 0.92);
          passive.lineTo(bpx - perpX * 0.92, bpy - perpY * 0.92);
          passive.stroke({ width: bandWidths[b], color: bands[b] });
        }
      } else if (isDiode) {
        // Fritzing-style diode: glass/dark body with silver cathode band
        const isLED = component.parameters['vForward'] >= 1.5;
        const bodyColor = isLED ? 0xcc2222 : 0x2a2a2a;
        const cathodeColor = isLED ? 0xeeeeee : 0xcccccc;

        const bx1 = bodyStartX + perpX, by1 = bodyStartY + perpY;
        const bx2 = bodyStartX - perpX, by2 = bodyStartY - perpY;
        const bx3 = bodyStartX + Math.cos(angle) * bodyLen - perpX;
        const by3 = bodyStartY + Math.sin(angle) * bodyLen - perpY;
        const bx4 = bodyStartX + Math.cos(angle) * bodyLen + perpX;
        const by4 = bodyStartY + Math.sin(angle) * bodyLen + perpY;
        passive.moveTo(bx1, by1); passive.lineTo(bx2, by2); passive.lineTo(bx3, by3); passive.lineTo(bx4, by4); passive.closePath();
        passive.fill(bodyColor);
        passive.stroke({ width: 1, color: 0x555555 });

        // Cathode band (stripe near pin 2 / cathode end)
        const bandT = 0.8;
        const bandX = bodyStartX + Math.cos(angle) * bodyLen * bandT;
        const bandY = bodyStartY + Math.sin(angle) * bodyLen * bandT;
        passive.moveTo(bandX + perpX, bandY + perpY);
        passive.lineTo(bandX - perpX, bandY - perpY);
        passive.stroke({ width: 3, color: cathodeColor });

        // Polarity triangle (anode side pointing towards cathode)
        if (!isLED) {
          const triT = 0.35;
          const triX = bodyStartX + Math.cos(angle) * bodyLen * triT;
          const triY = bodyStartY + Math.sin(angle) * bodyLen * triT;
          const triTip = 0.55;
          const tipX = bodyStartX + Math.cos(angle) * bodyLen * triTip;
          const tipY = bodyStartY + Math.sin(angle) * bodyLen * triTip;
          passive.moveTo(triX + perpX * 0.7, triY + perpY * 0.7);
          passive.lineTo(triX - perpX * 0.7, triY - perpY * 0.7);
          passive.lineTo(tipX, tipY);
          passive.closePath();
          passive.fill(0x555555);
        }
      } else if (isCap) {
        // Capacitor — ceramic disc (small values) or electrolytic barrel (large)
        const capValue = component.parameters['capacitance'] ?? 1e-7;
        const isElectrolytic = capValue >= 1e-6; // 1µF and above

        if (isElectrolytic) {
          // Electrolytic: cylindrical barrel body with polarity stripe
          const capR = bodyH / 2 + 1;
          passive.arc(bodyStartX, bodyStartY, capR, angle + Math.PI / 2, angle - Math.PI / 2);
          passive.lineTo(bodyEndX + perpX * 1.2, bodyEndY + perpY * 1.2);
          passive.arc(bodyEndX, bodyEndY, capR, angle - Math.PI / 2, angle + Math.PI / 2);
          passive.lineTo(bodyStartX - perpX * 1.2, bodyStartY - perpY * 1.2);
          passive.closePath();
          passive.fill(0x224488);
          passive.stroke({ width: 1, color: 0x1a3366 });

          // Negative stripe near pin 2 end
          const stripeT = 0.75;
          const sx = bodyStartX + Math.cos(angle) * bodyLen * stripeT;
          const sy = bodyStartY + Math.sin(angle) * bodyLen * stripeT;
          passive.moveTo(sx + perpX * 1.1, sy + perpY * 1.1);
          passive.lineTo(sx - perpX * 1.1, sy - perpY * 1.1);
          passive.stroke({ width: 3, color: 0xcccccc });

          // Minus sign
          const minusX = bodyStartX + Math.cos(angle) * bodyLen * 0.82;
          const minusY = bodyStartY + Math.sin(angle) * bodyLen * 0.82;
          passive.moveTo(minusX + perpX * 0.4, minusY + perpY * 0.4);
          passive.lineTo(minusX - perpX * 0.4, minusY - perpY * 0.4);
          passive.stroke({ width: 1.5, color: 0xeeeeee });
        } else {
          // Ceramic disc: flat oval body, typically orange/brown
          const discColor = capValue < 1e-9 ? 0xcc8844 : 0xdd9922; // brown for pF, orange for nF
          passive.ellipse(mx, my, bodyLen / 2, bodyH / 2 + 2);
          passive.fill(discColor);
          passive.stroke({ width: 0.8, color: 0x996622 });

          // Value text on disc
          let valText = '';
          if (capValue >= 1e-6) valText = `${(capValue * 1e6).toFixed(0)}µ`;
          else if (capValue >= 1e-9) valText = `${(capValue * 1e9).toFixed(0)}n`;
          else valText = `${(capValue * 1e12).toFixed(0)}p`;

          const valLabel = new Text({
            text: valText,
            style: new TextStyle({ fontSize: 7, fill: 0x553311, fontFamily: 'monospace', fontWeight: 'bold' }),
          });
          valLabel.anchor.set(0.5, 0.5);
          valLabel.x = mx;
          valLabel.y = my;
          valLabel.rotation = angle;
          container.addChild(valLabel);
        }
      } else {
        // Generic 2-pin passive fallback
        passive.ellipse(mx, my, bodyLen / 2, bodyH / 2);
        passive.fill(0x888888);
        passive.stroke({ width: 1, color: 0x666666 });
      }

      // Hole dots
      passive.circle(x1, y1, 2.5); passive.fill(0x666666);
      passive.circle(x2, y2, 2.5); passive.fill(0x666666);

      if (isSelected) {
        passive.circle(mx, my, bodyLen / 2 + 5);
        passive.stroke({ width: 2, color: COLORS.selected });
      }

      // Pin hover
      if (hp?.componentId === placement.componentId) {
        const glow = new Graphics();
        if (hp.pinIndex === 0) { glow.circle(x1, y1, 6); glow.stroke({ width: 2, color: 0x00ff88 }); }
        else if (hp.pinIndex === 1) { glow.circle(x2, y2, 6); glow.stroke({ width: 2, color: 0x00ff88 }); }
        container.addChild(glow);
      }

      passive.eventMode = 'static'; passive.cursor = 'pointer';
      passive.on('pointerdown', () => useUIStore.getState().selectItem(placement.componentId, 'component'));
      container.addChild(passive);
    }
  }

  // =========================================================
  // DRAW WIRE
  // =========================================================
  function drawWire(container: Container, wire: WireType) {
    if (!('row' in wire.from) || !('row' in wire.to)) return;
    const from = wire.from as HolePosition, to = wire.to as HolePosition;
    const x1 = holeX(from.col), y1 = holeY(from.row);
    const x2 = holeX(to.col), y2 = holeY(to.row);
    const isSelected = uiStore.selectedItemId === wire.id;
    const wireGfx = new Graphics();
    wireGfx.moveTo(x1, y1); wireGfx.lineTo(x2, y2);
    wireGfx.stroke({ width: isSelected ? 4 : 3, color: isSelected ? COLORS.selected : (COLORS.wireColors[wire.color] ?? 0x3366ff) });
    wireGfx.circle(x1, y1, 3.5); wireGfx.fill(COLORS.wireColors[wire.color] ?? 0x3366ff);
    wireGfx.circle(x2, y2, 3.5); wireGfx.fill(COLORS.wireColors[wire.color] ?? 0x3366ff);
    wireGfx.eventMode = 'static'; wireGfx.cursor = 'pointer';
    wireGfx.on('pointerdown', () => useUIStore.getState().selectItem(wire.id, 'wire'));
    container.addChild(wireGfx);
  }

  // =========================================================
  // HANDLE HOLE CLICK
  // =========================================================
  function handleHoleClick(row: number, col: BoardCol, _e: FederatedPointerEvent) {
    const ui = useUIStore.getState();

    if (ui.toolMode === 'place' && ui.selectedComponent) {
      const def = ui.selectedComponent;
      const isTransistor = def.type === 'transistor';
      const isPassive = def.pins.length <= 3 && !def.package.startsWith('DIP') && !isTransistor;

      if (isTransistor) {
        // Single-click: 3 pins in same column. Pin order: Collector(row-1), Base(row), Emitter(row+1)
        const componentId = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addComponent(
          { id: componentId, type: def.type, label: def.name, package: def.package, pins: [...def.pins], parameters: { ...def.defaultParameters } },
          { componentId, boardId: board.id, pin1Position: { row, col }, pin2Position: { row: row + 2, col }, orientation: 0 },
        );
      } else if (isPassive) {
        if (!ui.passivePin1) {
          ui.setPassivePin1({ row, col, boardId: board.id });
        } else {
          // Ignore if clicking the same hole or different board
          if (ui.passivePin1.row === row && ui.passivePin1.col === col) return;
          if (ui.passivePin1.boardId !== board.id) { ui.setPassivePin1({ row, col, boardId: board.id }); return; }
          const p1Col = ui.passivePin1.col as BoardCol;
          const p1Row = ui.passivePin1.row;
          const componentId = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          addComponent(
            { id: componentId, type: def.type, label: def.type, package: def.package, pins: [...def.pins], parameters: { ...def.defaultParameters } },
            { componentId, boardId: board.id, pin1Position: { row: p1Row, col: p1Col }, pin2Position: { row, col }, orientation: 0 },
          );
          ui.setPassivePin1(null);
        }
      } else {
        const componentId = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addComponent(
          { id: componentId, type: def.type, label: def.type, package: def.package, pins: [...def.pins], parameters: { ...def.defaultParameters } },
          { componentId, boardId: board.id, pin1Position: { row, col }, orientation: 0 },
        );
      }
    } else if (ui.toolMode === 'wire') {
      if (!ui.wireStart) {
        ui.setWireStart({ row, col, boardId: board.id });
      } else {
        const wireId = `wire-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const startBoardId = ui.wireStart.boardId ?? board.id;

        if (startBoardId === board.id) {
          // Same board — normal wire
          addWire(board.id, { id: wireId, from: { row: ui.wireStart.row, col: ui.wireStart.col as BoardCol }, to: { row, col }, color: ui.wireColor });
        } else {
          // Different boards — inter-board wire
          const { addInterBoardWire } = useCircuitStore.getState();
          addInterBoardWire({
            id: wireId,
            fromBoardId: startBoardId,
            fromPosition: { row: ui.wireStart.row, col: ui.wireStart.col as BoardCol },
            toBoardId: board.id,
            toPosition: { row, col },
            color: ui.wireColor,
          });
        }
        ui.setWireStart(null);
      }
    } else if (ui.toolMode === 'select') {
      ui.selectItem(null, null);
    }
  }

  return <div ref={canvasRef} style={{ width: '100%', height: '100%' }} />;
}
